# 🐙 GitHub Actions High-Performance CI/CD Setup

If you prefer to run the CI/CD pipeline on **GitHub Actions** rather than Jenkins, follow this step-by-step plan to replicate the workflow using GitHub's native CI/CD.

## Step 1: Prepare the GitHub Repository Settings
1. **Enable GitHub Actions**: Navigate to your GitHub repository -> **Settings** -> **Actions** -> **General**. Ensure that "Allow all actions and reusable workflows" is selected.
2. **Configure Package Permissions**: Your workflow needs permission to publish images to the GitHub Container Registry (GHCR) using the automatic `GITHUB_TOKEN`. Go to **Settings** -> **Actions** -> **General**, scroll down to **Workflow permissions**, and select **Read and write permissions**.

## Step 2: Create the Workflow File
In the root of your project, create the following directory structure: `.github/workflows/` and add a new file named `ci.yml` (e.g., `.github/workflows/ci.yml`).

## Step 3: Define the GitHub Actions Workflow
The workflow logic, parameterization (`workflow_dispatch` inputs), and stages mirror the Jenkins pipeline, including parallel execution and test artifact archiving.

```yaml
name: TaskFlow Enterprise CI/CD

on:
  push:
    branches: [ "main" ]
  pull_request:
    branches: [ "main" ]
  workflow_dispatch:
    inputs:
      run_lint_and_format:
        description: 'Run Dockerfile linting and Prettier checks'
        required: true
        default: true
        type: boolean
      run_tests:
        description: 'Run JUnit, Vitest, and compilation tests'
        required: true
        default: true
        type: boolean
      run_security_scans:
        description: 'Run Trivy container security scans'
        required: true
        default: true
        type: boolean

env:
  DOCKER_REGISTRY: ghcr.io
  IMAGE_TAG: ${{ github.run_number }}

jobs:
  lint-and-format:
    name: 🛠️ Initialization & Linting
    runs-on: ubuntu-latest
    if: ${{ github.event_name != 'workflow_dispatch' || inputs.run_lint_and_format }}
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Lint Dockerfiles
        uses: hadolint/hadolint-action@v3.1.0
        with:
          dockerfile: Dockerfile
          ignore: DL3018,DL3029

      - name: Lint Dockerfile.x64
        uses: hadolint/hadolint-action@v3.1.0
        with:
          dockerfile: Dockerfile.x64
          ignore: DL3018,DL3029

      - name: Lint Frontend Dockerfile
        uses: hadolint/hadolint-action@v3.1.0
        with:
          dockerfile: frontend/Dockerfile
          ignore: DL3018,DL3029

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: 'frontend/package-lock.json'

      - name: Check Frontend Formatting
        working-directory: ./frontend
        run: |
          npm ci
          npx prettier --check 'src/**/*.ts' 'src/**/*.html'

  build-and-test:
    name: 🧪 Parallel Build & Test
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Set up JDK 21
        uses: actions/setup-java@v4
        with:
          java-version: '21'
          distribution: 'temurin'
          cache: 'gradle'

      - name: Backend - Spring Boot AOT & Tests
        run: |
          if [ "${{ github.event_name == 'workflow_dispatch' && !inputs.run_tests }}" = "true" ]; then
            echo "Skipping tests, compiling Java & AOT assets only..."
            ./gradlew clean processAot bootJar -x test -x spotbugsMain -x spotbugsTest -x spotbugsAot --no-daemon -Dorg.gradle.jvmargs="-Xmx1536m"
          else
            echo "Running JUnit, ArchUnit, SpotBugs, and AOT compilation..."
            ./gradlew clean check processAot bootJar --no-daemon -Dorg.gradle.jvmargs="-Xmx1536m"
          fi

      - name: Upload Test Results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: backend-test-results
          path: build/test-results/test/*.xml

      - name: Upload JaCoCo Report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: backend-jacoco-report
          path: build/jacoco/*.exec

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: 'frontend/package-lock.json'

      - name: Frontend - Angular Tests & Build
        working-directory: ./frontend
        env:
          NODE_OPTIONS: --max-old-space-size=1536
        run: |
          npm ci
          if [ "${{ github.event_name == 'workflow_dispatch' && !inputs.run_tests }}" = "true" ]; then
            echo "Skipping frontend tests, building Angular Production assets only..."
            npm run build
          else
            echo "Running Vitest and Angular Production Build..."
            npm run test -- --watch=false
            npm run build
          fi

      - name: Upload Compiled Assets (JAR & dist)
        uses: actions/upload-artifact@v4
        with:
          name: compiled-assets
          path: |
            build/libs/*.jar
            frontend/dist/

  containerization:
    name: 📦 Containerization & Publish
    runs-on: ubuntu-latest
    needs: build-and-test
    permissions:
      contents: read
      packages: write
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Download Compiled Assets
        uses: actions/download-artifact@v4
        with:
          name: compiled-assets

      - name: Login to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build Backend Image
        uses: docker/build-push-action@v5
        with:
          context: .
          file: ./Dockerfile.x64
          platforms: linux/amd64
          push: false
          load: true
          tags: ${{ env.DOCKER_REGISTRY }}/${{ github.repository_owner }}/taskflow-backend:${{ env.IMAGE_TAG }}

      - name: Build Frontend Image
        uses: docker/build-push-action@v5
        with:
          context: ./frontend
          platforms: linux/amd64
          push: false
          load: true
          tags: ${{ env.DOCKER_REGISTRY }}/${{ github.repository_owner }}/taskflow-frontend:${{ env.IMAGE_TAG }}

      - name: Trivy Scan Backend
        if: ${{ github.event_name != 'workflow_dispatch' || inputs.run_security_scans }}
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ${{ env.DOCKER_REGISTRY }}/${{ github.repository_owner }}/taskflow-backend:${{ env.IMAGE_TAG }}
          format: 'table'
          exit-code: '0'
          ignore-unfixed: true
          vuln-type: 'os,library'
          severity: 'HIGH,CRITICAL'

      - name: Trivy Scan Frontend
        if: ${{ github.event_name != 'workflow_dispatch' || inputs.run_security_scans }}
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ${{ env.DOCKER_REGISTRY }}/${{ github.repository_owner }}/taskflow-frontend:${{ env.IMAGE_TAG }}
          format: 'table'
          exit-code: '0'
          ignore-unfixed: true
          vuln-type: 'os,library'
          severity: 'HIGH,CRITICAL'

      - name: Publish to GHCR
        if: github.ref == 'refs/heads/main'
        run: |
          docker push ${{ env.DOCKER_REGISTRY }}/${{ github.repository_owner }}/taskflow-backend:${{ env.IMAGE_TAG }}
          docker push ${{ env.DOCKER_REGISTRY }}/${{ github.repository_owner }}/taskflow-frontend:${{ env.IMAGE_TAG }}
```

## Step 4: Run the Workflow
* **Automatic Runs**: The pipeline will trigger seamlessly on code pushes and pull requests to the `main` branch.
* **Manual Runs (Parameterized)**: Go to the **Actions** tab in your repository, select the **TaskFlow Enterprise CI/CD** workflow on the left, and click **Run workflow**. You will be presented with the exact same interactive checkboxes for `run_lint_and_format`, `run_tests`, and `run_security_scans` that are available in Jenkins!
