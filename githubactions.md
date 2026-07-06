# 🐙 GitHub Actions High-Performance CI/CD Setup

If you prefer to run the CI/CD pipeline on **GitHub Actions** rather than Jenkins, follow this step-by-step plan to replicate the workflow using GitHub's native CI/CD.

## Step 1: Configure GitHub Actions & Package Permissions (Crucial)

To prevent `write_package` or `permission_denied` errors when pushing Docker images to the GitHub Container Registry (GHCR), you must ensure GitHub Actions has both repository-level and package-level read/write permissions.

### Option A: The Automatic GITHUB_TOKEN Method (Recommended)

#### Part 1: Repository Workflow Permissions
1. Navigate to your repository page on GitHub.
2. Click on the **Settings** tab (the gear icon on the top menu bar).
3. On the left sidebar, click on **Actions** -> **General**.
4. Scroll down to the bottom of the page to the **Workflow permissions** section.
5. Select **Read and write permissions**.
6. Check the box for **"Allow GitHub Actions to create and approve pull requests"** (if applicable).
7. Click the green **Save** button.

#### Part 2: GHCR Package Access (If the Docker Packages Already Exist)
If you previously built or pushed `taskflow-backend` or `taskflow-frontend` manually (e.g., via a local terminal or Personal Access Token), those packages are owned by your personal profile rather than the automated workflow token. You must explicitly link them to your repository:
1. Go to your personal GitHub profile (e.g., `https://github.com/your-username`).
2. Click on the **Packages** tab at the top.
3. Click on the package named **`taskflow-backend`** (and repeat for **`taskflow-frontend`**).
4. On the right-hand sidebar, click on **Package settings**.
5. Scroll down to the **Manage Actions access** section.
6. Click the **Add repository** button.
7. Search for your repository: **`stefanf81/taskflow-enterprise`** and select it.
8. Under the role dropdown, change it from **Read** to **Write** or **Admin**.
9. Click **Save** or **Add**.

---

### Option B: The Personal Access Token (PAT) Method (Use if Option A is restricted)

If your GitHub account belongs to an organization with strict enterprise policies blocking workflow write permissions, use a classic PAT:

#### Part 1: Generate your Personal Access Token
1. Click on your profile picture in the top-right corner of GitHub -> **Settings**.
2. Scroll to the bottom of the left sidebar and click **Developer settings**.
3. Select **Personal access tokens** -> **Tokens (classic)**.
4. Click **Generate new token** -> **Generate new token (classic)**.
5. Give it a descriptive name (e.g., `GHCR_Actions_Token`).
6. Select the following scopes:
   * **`write:packages`** (automatically selects `read:packages`)
   * **`delete:packages`** (optional, for cleanup)
7. Click **Generate token** and copy the resulting string immediately (it will not be shown again).

#### Part 2: Add Token as a Secret in the Repository
1. Navigate back to your repository page on GitHub.
2. Click **Settings** -> **Secrets and variables** -> **Actions** on the left menu.
3. Click **New repository secret**.
4. Set the **Name** to: **`CR_PAT`**.
5. Paste your copied Personal Access Token into the **Value** box.
6. Click **Add secret**.

---

## Step 2: Define the GitHub Actions Workflow

The workflow logic, parameterization (`workflow_dispatch` inputs), and stages mirror the Jenkins pipeline, including parallel execution, CodeQL SAST, and test artifact archiving.

Create a file named `.github/workflows/ci.yml` and paste the following content:

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
        description: 'Run JUnit, Vitest, E2E, and compilation tests'
        required: true
        default: false
        type: boolean
      run_security_scans:
        description: 'Run Trivy container security scans'
        required: true
        default: false
        type: boolean

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

env:
  DOCKER_REGISTRY: ghcr.io
  IMAGE_TAG: latest

jobs:
  changes:
    name: 🔍 Detect Changes
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
    outputs:
      backend: ${{ steps.filter.outputs.backend }}
      frontend: ${{ steps.filter.outputs.frontend }}
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v7
        with:
          fetch-depth: 0

      - name: Detect Changed Files
        id: filter
        uses: dorny/paths-filter@v4
        with:
          base: ${{ github.event.before != '0000000000000000000000000000000000000000' && github.event.before || github.sha }}
          filters: |
            backend:
              - 'src/**'
              - 'build.gradle'
              - 'Dockerfile.x64'
              - '.github/workflows/ci.yml'
            frontend:
              - 'frontend/**'
              - '.github/workflows/ci.yml'

  lint-dockerfiles:
    name: 🛠️ Lint Dockerfiles
    runs-on: ubuntu-latest
    needs: changes
    if: github.event_name != 'workflow_dispatch' || inputs.run_lint_and_format
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v7

      - name: Lint Dockerfiles
        uses: hadolint/hadolint-action@v3.3.0
        with:
          dockerfile: Dockerfile
          ignore: DL3018,DL3029

      - name: Lint Dockerfile.x64
        uses: hadolint/hadolint-action@v3.3.0
        with:
          dockerfile: Dockerfile.x64
          ignore: DL3018,DL3029

      - name: Lint Frontend Dockerfile
        uses: hadolint/hadolint-action@v3.3.0
        with:
          dockerfile: frontend/Dockerfile
          ignore: DL3018,DL3029

  codeql-analysis:
    name: 🛡️ CodeQL SAST Analysis
    runs-on: ubuntu-latest
    needs: changes
    if: github.event_name != 'workflow_dispatch' || inputs.run_security_scans
    permissions:
      security-events: write
      actions: read
      contents: read
    strategy:
      fail-fast: false
      matrix:
        language: [ 'java', 'javascript' ]
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v7

      - name: Initialize CodeQL
        uses: github/codeql-action/init@v4
        with:
          languages: ${{ matrix.language }}
          queries: security-extended,security-and-quality
          build-mode: none

      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@v4
        with:
          category: "/language:${{matrix.language}}"

  backend-pipeline:
    name: ☕ Backend (Build, Test & Containerize)
    runs-on: ubuntu-latest
    needs: changes
    if: github.ref == 'refs/heads/main' || github.event_name == 'workflow_dispatch' || needs.changes.outputs.backend == 'true'
    permissions:
      contents: read
      packages: write
      security-events: write
      pull-requests: write
      checks: write
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v7

      - name: Set up JDK 21
        uses: actions/setup-java@v5
        with:
          java-version: '21'
          distribution: 'temurin'

      - name: Setup Gradle Build Cache
        uses: gradle/actions/setup-gradle@v6

      - name: Backend - Spring Boot Tests
        if: github.event_name != 'workflow_dispatch' || inputs.run_tests
        run: |
          echo "Running JUnit, ArchUnit, and SpotBugs..."
          ./gradlew check --no-daemon --parallel --build-cache

      - name: Publish Test Report
        uses: mikepenz/action-junit-report@v6
        if: always() && (github.event_name != 'workflow_dispatch' || inputs.run_tests)
        with:
          report_paths: 'build/test-results/test/*.xml'
          commit: ${{github.sha}}
          fail_on_failure: true
          require_tests: true

      - name: Upload Test Results
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: backend-test-results
          path: build/test-results/test/*.xml
          retention-days: 7

      - name: Upload JaCoCo Report
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: backend-jacoco-report
          path: build/jacoco/*.exec
          retention-days: 7

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v4

      - name: Login to GitHub Container Registry
        uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build & Push Backend Image
        uses: docker/build-push-action@v7
        with:
          context: .
          file: ./Dockerfile.x64
          platforms: linux/amd64
          push: ${{ github.ref == 'refs/heads/main' }}
          load: ${{ github.ref != 'refs/heads/main' }}
          tags: ${{ env.DOCKER_REGISTRY }}/${{ github.repository_owner }}/taskflow-backend:${{ env.IMAGE_TAG }}
          cache-from: type=gha,scope=backend
          cache-to: type=gha,mode=max,scope=backend

      - name: Trivy Scan Backend
        if: github.event_name != 'workflow_dispatch' || inputs.run_security_scans
        uses: aquasecurity/trivy-action@v0.36.0
        with:
          image-ref: ${{ env.DOCKER_REGISTRY }}/${{ github.repository_owner }}/taskflow-backend:${{ env.IMAGE_TAG }}
          format: 'sarif'
          output: 'trivy-backend-results.sarif'
          ignore-unfixed: true
          vuln-type: 'os,library'
          severity: 'HIGH,CRITICAL'

      - name: Upload Trivy Scan Results
        if: github.event_name != 'workflow_dispatch' || inputs.run_security_scans
        uses: github/codeql-action/upload-sarif@v4
        with:
          sarif_file: 'trivy-backend-results.sarif'
          category: backend-container

  frontend-pipeline:
    name: 🎨 Frontend (Build, Test & Containerize)
    runs-on: ubuntu-latest
    needs: changes
    if: github.ref == 'refs/heads/main' || github.event_name == 'workflow_dispatch' || needs.changes.outputs.frontend == 'true'
    permissions:
      contents: read
      packages: write
      security-events: write
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v7

      - name: Setup Node.js
        uses: actions/setup-node@v6
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: 'frontend/package-lock.json'

      - name: Install Dependencies
        working-directory: ./frontend
        run: npm ci

      - name: Check Frontend Formatting
        if: github.event_name != 'workflow_dispatch' || inputs.run_lint_and_format
        working-directory: ./frontend
        run: npx prettier --check 'src/**/*.ts' 'src/**/*.html'

      - name: Frontend - Angular Tests
        if: github.event_name != 'workflow_dispatch' || inputs.run_tests
        working-directory: ./frontend
        env:
          NODE_OPTIONS: --max-old-space-size=1536
        run: |
          echo "Running Vitest..."
          npm run test -- --watch=false --coverage

      - name: Store Frontend Test Results
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: frontend-test-results
          path: frontend/coverage/
          retention-days: 7

      - name: Set up JDK 21 for E2E Tests
        if: github.event_name != 'workflow_dispatch' || inputs.run_tests
        uses: actions/setup-java@v5
        with:
          java-version: '21'
          distribution: 'temurin'

      - name: Setup Gradle for E2E Tests
        if: github.event_name != 'workflow_dispatch' || inputs.run_tests
        uses: gradle/actions/setup-gradle@v6
        with:
          cache-read-only: true

      - name: Start Spring Boot Backend in Background
        if: github.event_name != 'workflow_dispatch' || inputs.run_tests
        run: |
          nohup ./gradlew bootRun --no-daemon --parallel --build-cache > spring-boot.log 2>&1 &
          echo "Spring Boot starting in background..."
          for i in {1..45}; do
            if curl --fail -s http://localhost:8080/api/v1/catalog > /dev/null; then
              echo "Backend is up and running!"
              break
            fi
            echo "Waiting for backend... ($i)"
            sleep 2
          done
          head -n 100 spring-boot.log || true

      - name: Get Playwright version
        if: github.event_name != 'workflow_dispatch' || inputs.run_tests
        id: playwright-version
        working-directory: ./frontend
        run: echo "PLAYWRIGHT_VERSION=$(npx playwright --version | cut -d' ' -f2)" >> $GITHUB_ENV

      - name: Cache Playwright Browsers
        if: github.event_name != 'workflow_dispatch' || inputs.run_tests
        id: cache-playwright
        uses: actions/cache@v6
        with:
          path: ~/.cache/ms-playwright
          key: ${{ runner.os }}-playwright-${{ env.PLAYWRIGHT_VERSION }}

      - name: Frontend - Playwright E2E Tests
        if: github.event_name != 'workflow_dispatch' || inputs.run_tests
        working-directory: ./frontend
        run: |
          if [ "${{ steps.cache-playwright.outputs.cache-hit }}" != "true" ]; then
            npx playwright install --with-deps
          else
            npx playwright install-deps
          fi
          npm run e2e

      - name: Upload Playwright Report
        if: always() && (github.event_name != 'workflow_dispatch' || inputs.run_tests)
        uses: actions/upload-artifact@v7
        with:
          name: playwright-report
          path: frontend/playwright-report/
          retention-days: 7

      - name: Upload Spring Boot Logs
        if: always() && (github.event_name != 'workflow_dispatch' || inputs.run_tests)
        uses: actions/upload-artifact@v7
        with:
          name: spring-boot-logs
          path: spring-boot.log
          retention-days: 7

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v4

      - name: Login to GitHub Container Registry
        uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build & Push Frontend Image
        uses: docker/build-push-action@v7
        with:
          context: ./frontend
          platforms: linux/amd64
          push: ${{ github.ref == 'refs/heads/main' }}
          load: ${{ github.ref != 'refs/heads/main' }}
          tags: ${{ env.DOCKER_REGISTRY }}/${{ github.repository_owner }}/taskflow-frontend:${{ env.IMAGE_TAG }}
          cache-from: type=gha,scope=frontend
          cache-to: type=gha,mode=max,scope=frontend

      - name: Trivy Scan Frontend
        if: github.event_name != 'workflow_dispatch' || inputs.run_security_scans
        uses: aquasecurity/trivy-action@v0.36.0
        with:
          image-ref: ${{ env.DOCKER_REGISTRY }}/${{ github.repository_owner }}/taskflow-frontend:${{ env.IMAGE_TAG }}
          format: 'sarif'
          output: 'trivy-frontend-results.sarif'
          ignore-unfixed: true
          vuln-type: 'os,library'
          severity: 'HIGH,CRITICAL'

      - name: Upload Trivy Scan Results
        if: github.event_name != 'workflow_dispatch' || inputs.run_security_scans
        uses: github/codeql-action/upload-sarif@v4
        with:
          sarif_file: 'trivy-frontend-results.sarif'
          category: frontend-container

```

## Step 3: Run the Workflow
* **Automatic Runs**: The pipeline will trigger seamlessly on code pushes and pull requests to the `main` branch.
* **Manual Runs (Parameterized)**: Go to the **Actions** tab in your repository, select the **TaskFlow Enterprise CI/CD** workflow on the left, and click **Run workflow**. You will be presented with the exact same interactive checkboxes for `run_lint_and_format`, `run_tests`, and `run_security_scans` that are available in Jenkins!

## 🚨 Troubleshooting

### Error: `denied: permission_denied: write_package` during `docker push`

If you encounter a `write_package` permission error when the workflow attempts to push the images to GHCR, it means GitHub Actions is being blocked from writing to your registry. 

**Solution 1: Check Repository Workflow Permissions**
1. Go to your GitHub repository -> **Settings** -> **Actions** -> **General**.
2. Scroll down to **Workflow permissions**.
3. Ensure **Read and write permissions** is selected and click **Save**.

**Solution 2: Link the Package to the Repository (If package already exists)**
If you previously pushed this Docker image manually using a Personal Access Token, the package might be isolated from your repository's automated Action token.
1. Go to your personal GitHub profile and click on **Packages**.
2. Select the `taskflow-backend` (or `taskflow-frontend`) package.
3. Click on **Package settings** (usually on the right-hand sidebar).
4. Scroll down to **Manage Actions access**.
5. Click **Add Repository**, search for your `taskflow-enterprise` repository, and grant it **Write** access.

**Solution 3: Use a Personal Access Token (PAT)**
If you are pushing to an organization registry or the above steps don't work, you can use a PAT:
1. Generate a GitHub PAT with `write:packages` and `read:packages` scopes.
2. Go to your repository -> **Settings** -> **Secrets and variables** -> **Actions**.
3. Create a new repository secret named `CR_PAT` and paste your token.
4. In `.github/workflows/ci.yml`, change the login step to use your PAT:
   ```yaml
      - name: Login to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.CR_PAT }}
   ```
