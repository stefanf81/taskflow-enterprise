pipeline {
    agent any 

    parameters {
        booleanParam(name: 'RUN_LINT_AND_FORMAT', defaultValue: true, description: 'Run Dockerfile linting and Prettier checks')
        booleanParam(name: 'RUN_TESTS', defaultValue: true, description: 'Run JUnit, Vitest, and compilation tests')
        booleanParam(name: 'RUN_SECURITY_SCANS', defaultValue: true, description: 'Run Trivy container security scans')
    }

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
            when {
                expression { params.RUN_LINT_AND_FORMAT }
            }
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
                        script {
                            if (params.RUN_TESTS) {
                                echo "Running JUnit, ArchUnit, SpotBugs, and AOT compilation..."
                                sh 'docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "${WORKSPACE}:${WORKSPACE}" -w "${WORKSPACE}" eclipse-temurin:21-jdk ./gradlew clean check processAot bootJar --no-daemon -Dorg.gradle.jvmargs="-Xmx1536m"'
                            } else {
                                echo "Skipping tests, compiling Java & AOT assets only..."
                                sh 'docker run --rm -v "${WORKSPACE}:${WORKSPACE}" -w "${WORKSPACE}" eclipse-temurin:21-jdk ./gradlew clean processAot bootJar -x test -x spotbugsMain -x spotbugsTest -x spotbugsAot --no-daemon -Dorg.gradle.jvmargs="-Xmx1536m"'
                            }
                        }
                    }
                    post {
                        always {
                            junit allowEmptyResults: true, testResults: 'build/test-results/test/*.xml'
                            archiveArtifacts artifacts: 'build/jacoco/*.exec', allowEmptyArchive: true
                        }
                    }
                }

                stage('Frontend: Angular Tests & Build') {
                    steps {
                        script {
                            if (params.RUN_TESTS) {
                                echo "Running Vitest and Angular Production Build..."
                                sh 'docker run --rm -v "${WORKSPACE}:${WORKSPACE}" -w "${WORKSPACE}/frontend" -e NODE_OPTIONS=--max-old-space-size=1536 node:22-alpine sh -c "npm run test -- --watch=false && npm run build"'
                            } else {
                                echo "Skipping frontend tests, building Angular Production assets only..."
                                sh 'docker run --rm -v "${WORKSPACE}:${WORKSPACE}" -w "${WORKSPACE}/frontend" -e NODE_OPTIONS=--max-old-space-size=1536 node:22-alpine sh -c "npm run build"'
                            }
                        }
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
            when {
                expression { params.RUN_SECURITY_SCANS }
            }
            parallel {
                stage('Trivy: Backend') {
                    steps {
                        sh "docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy:latest image --severity HIGH,CRITICAL ${DOCKER_REGISTRY}/stefanf81/taskflow-backend:${IMAGE_TAG}"
                    }
                }
                stage('Trivy: Frontend') {
                    steps {
                        sh "docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy:latest image --severity HIGH,CRITICAL ${DOCKER_REGISTRY}/stefanf81/taskflow-frontend:${IMAGE_TAG}"
                    }
                }
            }
        }

        stage('🚀 Publish to GHCR') {
            when {
                anyOf {
                    branch 'main'
                    expression { env.GIT_BRANCH == 'origin/main' || env.GIT_BRANCH == 'main' }
                }
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
