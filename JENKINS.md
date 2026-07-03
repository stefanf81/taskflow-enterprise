# 🚀 TaskFlow High-Performance Jenkins (Docker-in-Docker) Setup & Pipeline Guide

This guide describes how to run, configure, and use a high-performance, plugin-free Jenkins CI/CD pipeline using **Docker-in-Docker (DinD)**. This setup is fully optimized for **MacBook Pro M4** local development (via Rancher Desktop/Docker Desktop) but can be easily deployed on any standard Linux VPS or bare-metal environment.

By utilizing standard shell executions of the Docker CLI instead of custom Jenkins plugins, this pipeline is **immune to Jenkins plugin compilation errors** (like the missing `docker` or `jacoco` properties) and requires zero custom plugins to be installed on the Jenkins master.

---

## 🛠️ Step 1: Start Jenkins via Docker-in-Docker

The customized Jenkins configuration is located in the `jenkins_docker_in_docker` folder. It is tuned with automated logging rotation, strict memory boundaries, and a persistent Docker layer volume cache so your builds run near-instantly.

1. **Navigate to the setup directory**:
   ```bash
   cd jenkins_docker_in_docker
   ```
2. **Launch the Jenkins Stack**:
   ```bash
   ./start.sh
   ```
   *This script compiles the customized Jenkins master container and launches the secure Docker-in-Docker (DinD) daemon.*

---

## 🔑 Step 2: Retrieve the Admin Password & Unlock

To unlock the Jenkins UI, you need the initial 32-character hexadecimal administrator password. You can retrieve it in one of two ways:

*   **Option A (Via Docker Logs)**:
    ```bash
    docker logs my-jenkins
    ```
    *Look for the block of asterisks `*********************************` in the console log.*

*   **Option B (Directly from Container File)**:
    ```bash
    docker exec my-jenkins cat /var/jenkins_home/secrets/initialAdminPassword
    ```

---

## 🏗️ Step 3: Initial Jenkins Wizard Configuration

1. Open your browser and navigate to the mapped host port: **[http://localhost:8081](http://localhost:8081)**.
2. **Unlock Jenkins**: Paste the admin password retrieved in Step 2.
3. **Install Suggested Plugins**: Select the default **"Install suggested plugins"** option and let the wizard complete.
4. **No Custom Plugins Required**: Because our modern pipeline utilizes standard Docker CLI commands directly in standard shell (`sh`) blocks, **you do not need to install the "Docker Pipeline" or "JaCoCo" plugins!** This ensures a fast, bloat-free Jenkins footprint.

---

## 🔐 Step 4: Configure GitHub Container Registry (GHCR) Credentials

Your pipeline needs permission to log in and publish images to the GitHub Container Registry under your `ghcr.io` profile.

1. **Generate a GitHub Personal Access Token (PAT)**:
   * Go to your GitHub account -> *Settings > Developer Settings > Personal Access Tokens > Tokens (classic)*.
   * Generate a new token with **`write:packages`** and **`read:packages`** scopes.
2. **Add Credentials in Jenkins**:
   * On Jenkins, go to **Manage Jenkins** -> **Credentials** -> **System** -> **Global credentials (unrestricted)**.
   * Click **Add Credentials**.
   * Select **Username with password**.
   * Configure the following fields:
     * **Username**: Your GitHub username (e.g., `stefanf81`).
     * **Password**: Your generated Personal Access Token (PAT).
     * **ID**: **`github-ghcr-creds`** *(This ID must match the value defined in the Jenkinsfile environment block).*
   * Click **Create**.

---

## 📂 Step 5: Create the Pipeline Project

1. On the Jenkins home page, click **New Item**.
2. Enter the name: **`taskflow-enterprise`** and select **Pipeline**. Click **OK**.
3. Under **General**, select **GitHub project** and enter your repository URL:
   `https://github.com/stefanf81/taskflow-enterprise`
4. Scroll down to the **Pipeline** section:
   * **Definition**: Select **Pipeline script from SCM**.
   * **SCM**: Select **Git**.
   * **Repository URL**: `https://github.com/stefanf81/taskflow-enterprise`
   * **Credentials**: Select `-none-` (unless your repository is private, in which case select or add your GitHub access credentials).
   * **Branch Specifier**: Change `*/master` to **`*/main`**.
   * **Script Path**: Verify it is set to **`Jenkinsfile`**.
5. Click **Save**.

---

## ⚡ Step 6: Run & Parameterize Your Pipeline

The TaskFlow pipeline is **fully parameterized** to support fast local compilations.

1. **The First Build (Parameter Registration)**:
   * On your pipeline project page, click **"Build Now"**.
   * This initial run will read the `Jenkinsfile`, clone the repository, and register the build parameters in Jenkins' internal metadata.
2. **Build with Parameters (Subsequent Runs)**:
   * For all subsequent runs, the "Build Now" button will dynamically transform into **"Build with Parameters"**.
   * Clicking this will present you with interactive checkboxes to toggle pipeline features on-the-fly:
     * `RUN_LINT_AND_FORMAT` (Default: `true`) — Uncheck to bypass Dockerfile linting and Prettier checks.
     * `RUN_TESTS` (Default: `true`) — Uncheck to bypass backend JUnit and frontend Vitest executions. *(Note: Compilation and packaging still run automatically so the downstream containerization stage succeeds!)*
     * `RUN_SECURITY_SCANS` (Default: `true`) — Uncheck to bypass Trivy security scans.

---

## 🛑 Step 7: Lifecycle Management (Stop, Restart, or Teardown)

*   **Stop Jenkins**:
    If you are done playing with Jenkins and want to free up RAM/CPU resources on your MacBook Pro M4, simply run the stop script:
    ```bash
    cd jenkins_docker_in_docker
    ./stop.sh
    ```
    *All of your build logs, configuration keys, and persistent Docker layer caches will be safely preserved inside named volumes and ready for your next session!*

*   **Restart Jenkins**:
    To launch it again later, just re-run:
    ```bash
    ./start.sh
    ```

*   **Complete Teardown (Remove All Data)**:
    If you wish to delete all stored Jenkins configs, build history, and Docker image caches:
    ```bash
    cd jenkins_docker_in_docker
    docker compose down --volumes --rmi all
    ```

---

## 🐙 Migrating to GitHub Actions

If you prefer to run this exact pipeline on **GitHub Actions** rather than Jenkins, follow this step-by-step plan to replicate the `Jenkinsfile` workflow using GitHub's native CI/CD.

### Step 1: Prepare the GitHub Repository Settings
1. **Enable GitHub Actions**: Navigate to your GitHub repository -> **Settings** -> **Actions** -> **General**. Ensure that "Allow all actions and reusable workflows" is selected.
2. **Configure Package Permissions**: Your workflow needs permission to publish images to the GitHub Container Registry (GHCR) using the automatic `GITHUB_TOKEN`. Go to **Settings** -> **Actions** -> **General**, scroll down to **Workflow permissions**, and select **Read and write permissions**.

### Step 2: Create the Workflow File
In the root of your project, create the following directory structure: `.github/workflows/` and add a new file named `ci.yml` (e.g., `.github/workflows/ci.yml`).

### Step 3: Define the GitHub Actions Workflow
Copy and paste the following YAML into `.github/workflows/ci.yml`. This mirrors the logic, parameterization (`workflow_dispatch` inputs), and stages of our Jenkins pipeline, including parallel execution and test artifact archiving.

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

### Step 4: Commit and Push
1. Add the new workflow file using git: `git add .github/workflows/ci.yml`
2. Commit the changes: `git commit -m "ci: add GitHub Actions workflow mirroring Jenkins pipeline"`
3. Push your branch to GitHub: `git push origin main`

### Step 5: Run the Workflow
* **Automatic Runs**: The pipeline will now trigger seamlessly on code pushes and pull requests to the `main` branch.
* **Manual Runs (Parameterized)**: Go to the **Actions** tab in your repository, select the **TaskFlow Enterprise CI/CD** workflow on the left, and click **Run workflow**. You will be presented with the exact same interactive checkboxes for `run_lint_and_format`, `run_tests`, and `run_security_scans` that you originally had configured in Jenkins!
