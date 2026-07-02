pipeline {
    agent any 

    environment {
        DOCKER_BUILDKIT = '1'
        DOCKER_REGISTRY = 'ghcr.io'
        IMAGE_TAG = "${env.BUILD_NUMBER}"
        // Set this up in Jenkins credentials as per JENKINS.md:
        DOCKER_CREDS = credentials('github-ghcr-creds')
    }

    options {
        buildDiscarder(logRotator(numToKeepStr: '10'))
        disableConcurrentBuilds()
        timeout(time: 30, unit: 'MINUTES')
    }

    stages {
        stage('🛠️ Initialization & Linting') {
            parallel {
                stage('Lint Dockerfiles') {
                    steps {
                        script {
                            echo "Running Hadolint on Dockerfiles..."
                            sh 'docker run --rm -i --entrypoint hadolint hadolint/hadolint --ignore DL3018 --ignore DL3029 - < Dockerfile'
                            sh 'docker run --rm -i --entrypoint hadolint hadolint/hadolint --ignore DL3018 --ignore DL3029 - < Dockerfile.x64'
                            sh 'docker run --rm -i --entrypoint hadolint hadolint/hadolint --ignore DL3018 --ignore DL3029 - < frontend/Dockerfile'
                        }
                    }
                }
                stage('Check Frontend Formatting') {
                    steps {
                        sh 'docker run --rm -v "${WORKSPACE}:${WORKSPACE}" -w "${WORKSPACE}/frontend" node:22-alpine sh -c "npm ci && npx prettier --check \'src/**/*.ts\' \'src/**/*.html\'"'
                    }
                }
            }
        }

        stage('🧪 Parallel Build & Test (RAM Capped)') {
            parallel {
                stage('Backend: Spring Boot AOT & Tests') {
                    steps {
                        sh 'docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "${WORKSPACE}:${WORKSPACE}" -w "${WORKSPACE}" eclipse-temurin:21-jdk ./gradlew clean check processAot bootJar --no-daemon -Dorg.gradle.jvmargs="-Xmx1536m"'
                    }
                    post {
                        always {
                            junit 'build/test-results/test/*.xml'
                            archiveArtifacts artifacts: 'build/jacoco/*.exec', allowEmptyArchive: true
                        }
                    }
                }

                stage('Frontend: Angular Tests & Build') {
                    steps {
                        sh 'docker run --rm -v "${WORKSPACE}:${WORKSPACE}" -w "${WORKSPACE}/frontend" -e NODE_OPTIONS=--max-old-space-size=1536 node:22-alpine sh -c "npm run test -- --watch=false && npm run build"'
                    }
                }
            }
        }

        stage('📦 Containerization (BuildKit)') {
            steps {
                script {
                    echo "Building Production Images..."
                    // Cross-compile the x64 AMD image (Using Dockerfile.x64 customized for Ryzen)
                    sh "docker build --platform linux/amd64 -t ${DOCKER_REGISTRY}/stefanf81/taskflow-backend:${IMAGE_TAG} -f Dockerfile.x64 ."
                    sh "docker build --platform linux/amd64 -t ${DOCKER_REGISTRY}/stefanf81/taskflow-frontend:${IMAGE_TAG} ./frontend"
                }
            }
        }

        stage('🛡️ Container Security Scans') {
            parallel {
                stage('Trivy: Backend') {
                    steps {
                        sh "docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy:latest image --severity HIGH,CRITICAL --exit-code 1 ${DOCKER_REGISTRY}/stefanf81/taskflow-backend:${IMAGE_TAG}"
                    }
                }
                stage('Trivy: Frontend') {
                    steps {
                        sh "docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy:latest image --severity HIGH,CRITICAL --exit-code 1 ${DOCKER_REGISTRY}/stefanf81/taskflow-frontend:${IMAGE_TAG}"
                    }
                }
            }
        }

        stage('🚀 Publish to GHCR') {
            when {
                branch 'main'
            }
            steps {
                sh 'echo $DOCKER_CREDS_PSW | docker login $DOCKER_REGISTRY -u $DOCKER_CREDS_USR --password-stdin'
                sh 'docker push $DOCKER_REGISTRY/stefanf81/taskflow-backend:$IMAGE_TAG'
                sh 'docker push $DOCKER_REGISTRY/stefanf81/taskflow-frontend:$IMAGE_TAG'
                sh 'docker logout $DOCKER_REGISTRY'
            }
        }
    }

    post {
        failure {
            echo "❌ Pipeline failed! Check Jenkins logs for details."
        }
        success {
            echo "✅ Pipeline completed successfully! Images pushed to GHCR."
        }
    }
}
