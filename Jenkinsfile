pipeline {
    agent any

    parameters {
        booleanParam(name: 'RUN_LINT_AND_FORMAT', defaultValue: true, description: 'Run Dockerfile linting and Prettier checks')
        booleanParam(name: 'RUN_TESTS', defaultValue: true, description: 'Run JUnit, Vitest, and compilation tests')
        booleanParam(name: 'RUN_E2E_TESTS', defaultValue: true, description: 'Run Playwright End-to-End tests inside Docker Compose')
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
        timeout(time: 45, unit: 'MINUTES')
    }

    stages {
        stage('🔍 Detect Changes') {
            steps {
                script {
                    // Force run all stages on main or manually-triggered builds
                    def isMain = (env.BRANCH_NAME == 'main' || env.GIT_BRANCH == 'origin/main' || env.GIT_BRANCH == 'main')
                    if (isMain || currentBuild.getBuildCauses().toString().contains('Manual')) {
                        env.BACKEND_CHANGED = 'true'
                        env.FRONTEND_CHANGED = 'true'
                        env.DOCKER_CHANGED = 'true'
                    } else {
                        try {
                            def changedFiles = sh(script: "git diff --name-only HEAD~1 HEAD || true", returnStdout: true).trim()
                            echo "Changed files detected:\n${changedFiles}"

                            env.BACKEND_CHANGED = changedFiles.split("\n").any {
                                it.startsWith("src/") || it == "build.gradle" || it == "settings.gradle" || it.startsWith("gradle/")
                            } ? 'true' : 'false'

                            env.FRONTEND_CHANGED = changedFiles.split("\n").any {
                                it.startsWith("frontend/")
                            } ? 'true' : 'false'

                            env.DOCKER_CHANGED = changedFiles.split("\n").any {
                                it.startsWith("Dockerfile") || it.startsWith("docker/") || it.contains("Jenkinsfile")
                            } ? 'true' : 'false'
                        } catch (Exception e) {
                            echo "Could not accurately detect changed files: ${e.message}. Running all stages as fallback."
                            env.BACKEND_CHANGED = 'true'
                            env.FRONTEND_CHANGED = 'true'
                            env.DOCKER_CHANGED = 'true'
                        }
                    }
                    echo "Change flags set -> Backend: ${env.BACKEND_CHANGED}, Frontend: ${env.FRONTEND_CHANGED}, Docker: ${env.DOCKER_CHANGED}"
                }
            }
        }

        stage('🛠️ Initialization & Linting') {
            when {
                expression { params.RUN_LINT_AND_FORMAT }
            }
            parallel {
                stage('Lint Dockerfiles') {
                    when {
                        expression { env.DOCKER_CHANGED == 'true' }
                    }
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
                    when {
                        expression { env.FRONTEND_CHANGED == 'true' }
                    }
                    steps {
                        // Optimizations:
                        // 1. Mount persistent 'jenkins-npm-cache' volume to /root/.npm to speed up npm downloads.
                        // 2. Add speed optimizations: --prefer-offline --no-audit --no-fund
                        sh 'docker run --rm -v jenkins-npm-cache:/root/.npm -v "${WORKSPACE}:${WORKSPACE}" -w "${WORKSPACE}/frontend" node:22-alpine sh -c "npm ci --prefer-offline --no-audit --no-fund && npx prettier --check \'src/**/*.ts\' \'src/**/*.html\'"'
                    }
                }
            }
        }

        stage('🧪 Parallel Build & Test (RAM & Dependency Capped)') {
            parallel {
                stage('Backend: Build & Tests') {
                    when {
                        expression { env.BACKEND_CHANGED == 'true' }
                    }
                    steps {
                        script {
                            // Optimization: Map 'jenkins-gradle-cache' volume to gradle home. Saves minutes of downloading plugins/dependencies every run!
                            if (params.RUN_TESTS) {
                                echo "Running JUnit, ArchUnit, SpotBugs, and coverage reports..."
                                sh 'docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v jenkins-gradle-cache:/root/.gradle -v "${WORKSPACE}:${WORKSPACE}" -w "${WORKSPACE}" eclipse-temurin:21-jdk ./gradlew clean check jacocoTestReport bootJar --no-daemon -Dorg.gradle.jvmargs="-Xmx1536m"'
                            } else {
                                echo "Skipping tests, compiling Java only..."
                                sh 'docker run --rm -v jenkins-gradle-cache:/root/.gradle -v "${WORKSPACE}:${WORKSPACE}" -w "${WORKSPACE}" eclipse-temurin:21-jdk ./gradlew clean bootJar -x test -x spotbugsMain -x spotbugsTest --no-daemon -Dorg.gradle.jvmargs="-Xmx1536m"'
                            }
                        }
                    }
                    post {
                        always {
                            junit allowEmptyResults: true, testResults: 'build/test-results/test/*.xml'
                            // Ported from GHA: Generate and archive readable HTML/XML Jacoco coverage reports
                            archiveArtifacts artifacts: 'build/reports/tests/**, build/reports/jacoco/test/html/**', allowEmptyArchive: true
                            archiveArtifacts artifacts: 'build/jacoco/*.exec', allowEmptyArchive: true
                        }
                    }
                }

                stage('Frontend: Angular Tests & Build') {
                    when {
                        expression { env.FRONTEND_CHANGED == 'true' }
                    }
                    steps {
                        script {
                            // Fixes bug where node_modules is missing if Lint was skipped. Caches via jenkins-npm-cache.
                            if (params.RUN_TESTS) {
                                echo "Running Vitest and Angular Production Build..."
                                sh 'docker run --rm -v jenkins-npm-cache:/root/.npm -v "${WORKSPACE}:${WORKSPACE}" -w "${WORKSPACE}/frontend" -e NODE_OPTIONS=--max-old-space-size=1536 node:22-alpine sh -c "npm ci --prefer-offline --no-audit --no-fund && npm run test -- --watch=false --coverage && npm run build"'
                            } else {
                                echo "Skipping frontend tests, building Angular Production assets only..."
                                sh 'docker run --rm -v jenkins-npm-cache:/root/.npm -v "${WORKSPACE}:${WORKSPACE}" -w "${WORKSPACE}/frontend" -e NODE_OPTIONS=--max-old-space-size=1536 node:22-alpine sh -c "npm ci --prefer-offline --no-audit --no-fund && npm run build"'
                            }
                        }
                    }
                    post {
                        always {
                            // Store coverage report as artifact
                            archiveArtifacts artifacts: 'frontend/coverage/**', allowEmptyArchive: true
                        }
                    }
                }
            }
        }

        stage('📦 Containerization (BuildKit)') {
            when {
                expression { env.BACKEND_CHANGED == 'true' || env.FRONTEND_CHANGED == 'true' || env.DOCKER_CHANGED == 'true' }
            }
            steps {
                script {
                    echo "Building Production Images..."
                    sh "docker build --platform linux/amd64 -t ${DOCKER_REGISTRY}/stefanf81/taskflow-backend:${IMAGE_TAG} -f Dockerfile.x64 ."
                    sh "docker build --platform linux/amd64 -t ${DOCKER_REGISTRY}/stefanf81/taskflow-frontend:${IMAGE_TAG} ./frontend"
                }
            }
        }

        stage('🛡️ Container Security Scans') {
            when {
                all {
                    expression { params.RUN_SECURITY_SCANS }
                    expression { env.BACKEND_CHANGED == 'true' || env.FRONTEND_CHANGED == 'true' || env.DOCKER_CHANGED == 'true' }
                }
            }
            parallel {
                stage('Trivy: Backend') {
                    steps {
                        // Optimization: Mount jenkins-trivy-cache to avoid downloading the Trivy vulnerability database (50MB+) on every scan!
                        sh "docker run --rm -v jenkins-trivy-cache:/root/.cache -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy:latest image --severity HIGH,CRITICAL ${DOCKER_REGISTRY}/stefanf81/taskflow-backend:${IMAGE_TAG}"
                    }
                }
                stage('Trivy: Frontend') {
                    steps {
                        sh "docker run --rm -v jenkins-trivy-cache:/root/.cache -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy:latest image --severity HIGH,CRITICAL ${DOCKER_REGISTRY}/stefanf81/taskflow-frontend:${IMAGE_TAG}"
                    }
                }
            }
        }

        stage('🎭 Playwright End-to-End Tests') {
            when {
                all {
                    expression { params.RUN_E2E_TESTS }
                    expression { env.BACKEND_CHANGED == 'true' || env.FRONTEND_CHANGED == 'true' }
                }
            }
            steps {
                script {
                    echo "Spinning up complete Docker Compose stack for Playwright E2E tests..."
                    try {
                        // 1. Start the stack (PostgreSQL, Redis, Backend, Frontend)
                        sh './start-docker.sh'

                        // 2. Wait for Backend health endpoint to be green (mirrors GHA /actuator/health wait loop)
                        echo "Waiting for backend health to report UP..."
                        sh 'docker run --rm --network host alpine/curl sh -c "for i in $(seq 1 45); do curl -fs http://localhost:8080/actuator/health/liveness && exit 0 || sleep 2; done; echo \"Backend failed to become healthy\"; exit 1"'

                        // 3. Run Playwright inside official Playwright container (browsers pre-installed, no npx install needed)
                        echo "Running Playwright E2E tests..."
                        sh 'docker run --rm --network host -v "${WORKSPACE}:${WORKSPACE}" -w "${WORKSPACE}/frontend" mcr.microsoft.com/playwright:v1.61.1-noble sh -c "npm ci --prefer-offline --no-audit --no-fund && npm run e2e"'
                    } finally {
                        // 4. Always tear down the Docker stack to prevent resource leaks on the runner
                        echo "Cleaning up Docker Compose stack..."
                        sh './stop-docker.sh || true'
                    }
                }
            }
            post {
                always {
                    archiveArtifacts artifacts: 'frontend/playwright-report/**, frontend/test-results/**', allowEmptyArchive: true
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

                // Push standard build-number tag
                sh 'docker push $DOCKER_REGISTRY/stefanf81/taskflow-backend:$IMAGE_TAG'
                sh 'docker push $DOCKER_REGISTRY/stefanf81/taskflow-frontend:$IMAGE_TAG'

                // Ported from GHA: Create and push 'latest' tags for main branch builds
                sh 'docker tag $DOCKER_REGISTRY/stefanf81/taskflow-backend:$IMAGE_TAG $DOCKER_REGISTRY/stefanf81/taskflow-backend:latest'
                sh 'docker tag $DOCKER_REGISTRY/stefanf81/taskflow-frontend:$IMAGE_TAG $DOCKER_REGISTRY/stefanf81/taskflow-frontend:latest'
                sh 'docker push $DOCKER_REGISTRY/stefanf81/taskflow-backend:latest'
                sh 'docker push $DOCKER_REGISTRY/stefanf81/taskflow-frontend:latest'

                sh 'docker logout $DOCKER_REGISTRY'
            }
        }
    }

    post {
        failure {
            echo "❌ Pipeline failed! Check Jenkins console output or archived artifacts."
        }
        success {
            echo "✅ Pipeline completed successfully! Images pushed to GHCR under tags '${IMAGE_TAG}' and 'latest'."
        }
    }
}
