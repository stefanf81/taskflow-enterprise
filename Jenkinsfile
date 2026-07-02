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
                            sh 'docker run --rm -i hadolint/hadolint < Dockerfile'
                            sh 'docker run --rm -i hadolint/hadolint < Dockerfile.x64'
                            sh 'docker run --rm -i hadolint/hadolint < frontend/Dockerfile'
                        }
                    }
                }
                stage('Check Frontend Formatting') {
                    steps {
                        script {
                            dir('frontend') {
                                docker.image('node:22-alpine').inside {
                                    sh 'npm ci'
                                    sh 'npx prettier --check "src/**/*.ts" "src/**/*.html"'
                                }
                            }
                        }
                    }
                }
            }
        }

        stage('🧪 Parallel Build & Test (RAM Capped)') {
            parallel {
                stage('Backend: Spring Boot AOT & Tests') {
                    steps {
                        // Mount docker.sock for Testcontainers
                        docker.image('eclipse-temurin:21-jdk').inside('-v /var/run/docker.sock:/var/run/docker.sock') {
                            echo "Running JUnit, ArchUnit, SpotBugs, and AOT compilation..."
                            
                            // [PRO-MOVE] Limit the Gradle Daemon and Java compiler to a strict 1.5GB Heap limit
                            // to ensure Jenkins VM does not trigger an Out-Of-Memory (OOM) killer event during parallel builds
                            sh './gradlew clean check processAot bootJar --no-daemon -Dorg.gradle.jvmargs="-Xmx1536m"'
                        }
                    }
                    post {
                        always {
                            junit 'build/test-results/test/*.xml'
                            jacoco execPattern: 'build/jacoco/*.exec'
                        }
                    }
                }

                stage('Frontend: Angular Tests & Build') {
                    steps {
                        script {
                            dir('frontend') {
                                docker.image('node:22-alpine').inside {
                                    echo "Running Vitest and Angular Production Build..."
                                    
                                    // [PRO-MOVE] Limit the Node.js V8 Engine/Angular Compiler to a strict 1.5GB Heap limit
                                    withEnv(['NODE_OPTIONS=--max-old-space-size=1536']) {
                                        sh 'npm run test -- --watch=false'
                                        sh 'npm run build'
                                    }
                                }
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
                script {
                    echo "Pushing verified images to GitHub Container Registry..."
                    docker.withRegistry("https://${DOCKER_REGISTRY}", 'github-ghcr-creds') {
                        sh "docker push ${DOCKER_REGISTRY}/stefanf81/taskflow-backend:${IMAGE_TAG}"
                        sh "docker push ${DOCKER_REGISTRY}/stefanf81/taskflow-frontend:${IMAGE_TAG}"
                    }
                }
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
