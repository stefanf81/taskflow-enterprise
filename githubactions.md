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
3. Click on the package named **`taskflow-backend`** (and later repeat for **`taskflow-frontend`**).
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

#### Part 3: Update `ci.yml` Login Step
Update `.github/workflows/ci.yml` in the `Login to GitHub Container Registry` step to use your secret:
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
  IMAGE_TAG: ${{ github.run_number }}

jobs:
  changes:
    name: 🔍 Detect Changes
    runs-on: ubuntu-latest
    outputs:
      backend: ${{ steps.filter.outputs.backend }}
      frontend: ${{ steps.filter.outputs.frontend }}
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v5

      - name: Detect Changed Files
        id: filter
        uses: dorny/paths-filter@v3
        with:
          filters: |
            backend:
              - 'src/**'
              - 'build.gradle'
              - 'Dockerfile.x64'
              - '.github/workflows/ci.yml'
            frontend:
              - 'frontend/**'
              - '.github/workflows/ci.yml'

  lint-and-format:
    name: 🛠️ Initialization & Linting
    runs-on: ubuntu-latest
    needs: changes
    if: ${{ github.event_name != 'workflow_dispatch' || inputs.run_lint_and_format }}
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v5

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
        uses: actions/setup-node@v5
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: 'frontend/package-lock.json'

      - name: Check Frontend Formatting
        working-directory: ./frontend
        run: |
          npm ci
          npx prettier --check 'src/**/*.ts' 'src/**/*.html'

  backend-pipeline:
    name: ☕ Backend (Build, Test & Containerize)
    runs-on: ubuntu-latest
    needs: changes
    if: ${{ github.ref == 'refs/heads/main' || github.event_name == 'workflow_dispatch' || needs.changes.outputs.backend == 'true' }}
    permissions:
      contents: read
      packages: write
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v5

      - name: Set up JDK 21
        uses: actions/setup-java@v5
        with:
          java-version: '21'
          distribution: 'temurin'

      - name: Setup Gradle Build Cache
        uses: gradle/actions/setup-gradle@v6

      - name: Backend - Spring Boot Tests
        if: ${{ github.event_name != 'workflow_dispatch' || inputs.run_tests == true }}
        run: |
          echo "Running JUnit, ArchUnit, and SpotBugs..."
          ./gradlew clean check --no-daemon -Dorg.gradle.jvmargs="-Xmx1536m"

      - name: Upload Test Results
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: backend-test-results
          path: build/test-results/test/*.xml

      - name: Upload JaCoCo Report
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: backend-jacoco-report
          path: build/jacoco/*.exec

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
          tags: |
            ${{ env.DOCKER_REGISTRY }}/${{ github.repository_owner }}/taskflow-backend:${{ env.IMAGE_TAG }}
            ${{ env.DOCKER_REGISTRY }}/${{ github.repository_owner }}/taskflow-backend:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Trivy Scan Backend
        if: ${{ github.event_name != 'workflow_dispatch' || inputs.run_security_scans }}
        uses: aquasecurity/trivy-action@v0.36.0
        with:
          image-ref: ${{ env.DOCKER_REGISTRY }}/${{ github.repository_owner }}/taskflow-backend:${{ env.IMAGE_TAG }}
          format: 'table'
          exit-code: '0'
          ignore-unfixed: true
          vuln-type: 'os,library'
          severity: 'HIGH,CRITICAL'

  frontend-pipeline:
    name: 🎨 Frontend (Build, Test & Containerize)
    runs-on: ubuntu-latest
    needs: changes
    if: ${{ github.ref == 'refs/heads/main' || github.event_name == 'workflow_dispatch' || needs.changes.outputs.frontend == 'true' }}
    permissions:
      contents: read
      packages: write
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v5

      - name: Setup Node.js
        uses: actions/setup-node@v5
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: 'frontend/package-lock.json'

      - name: Frontend - Angular Tests
        if: ${{ github.event_name != 'workflow_dispatch' || inputs.run_tests == true }}
        working-directory: ./frontend
        env:
          NODE_OPTIONS: --max-old-space-size=1536
        run: |
          npm ci
          echo "Running Vitest..."
          npm run test -- --watch=false

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
          tags: |
            ${{ env.DOCKER_REGISTRY }}/${{ github.repository_owner }}/taskflow-frontend:${{ env.IMAGE_TAG }}
            ${{ env.DOCKER_REGISTRY }}/${{ github.repository_owner }}/taskflow-frontend:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Trivy Scan Frontend
        if: ${{ github.event_name != 'workflow_dispatch' || inputs.run_security_scans }}
        uses: aquasecurity/trivy-action@v0.36.0
        with:
          image-ref: ${{ env.DOCKER_REGISTRY }}/${{ github.repository_owner }}/taskflow-frontend:${{ env.IMAGE_TAG }}
          format: 'table'
          exit-code: '0'
          ignore-unfixed: true
          vuln-type: 'os,library'
          severity: 'HIGH,CRITICAL'

```

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
  IMAGE_TAG: ${{ github.run_number }}

jobs:
  changes:
    name: 🔍 Detect Changes
    runs-on: ubuntu-latest
    outputs:
      backend: ${{ steps.filter.outputs.backend }}
      frontend: ${{ steps.filter.outputs.frontend }}
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v5

      - name: Detect Changed Files
        id: filter
        uses: dorny/paths-filter@v3
        with:
          filters: |
            backend:
              - 'src/**'
              - 'build.gradle'
              - 'Dockerfile.x64'
              - '.github/workflows/ci.yml'
            frontend:
              - 'frontend/**'
              - '.github/workflows/ci.yml'

  lint-and-format:
    name: 🛠️ Initialization & Linting
    runs-on: ubuntu-latest
    needs: changes
    if: ${{ github.event_name != 'workflow_dispatch' || inputs.run_lint_and_format }}
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v5

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
        uses: actions/setup-node@v5
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: 'frontend/package-lock.json'

      - name: Check Frontend Formatting
        working-directory: ./frontend
        run: |
          npm ci
          npx prettier --check 'src/**/*.ts' 'src/**/*.html'

  backend-pipeline:
    name: ☕ Backend (Build, Test & Containerize)
    runs-on: ubuntu-latest
    needs: changes
    if: ${{ github.ref == 'refs/heads/main' || github.event_name == 'workflow_dispatch' || needs.changes.outputs.backend == 'true' }}
    permissions:
      contents: read
      packages: write
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v5

      - name: Set up JDK 21
        uses: actions/setup-java@v5
        with:
          java-version: '21'
          distribution: 'temurin'

      - name: Setup Gradle Build Cache
        uses: gradle/actions/setup-gradle@v6

      - name: Backend - Spring Boot Tests
        if: ${{ github.event_name != 'workflow_dispatch' || inputs.run_tests == true }}
        run: |
          echo "Running JUnit, ArchUnit, and SpotBugs..."
          ./gradlew clean check --no-daemon -Dorg.gradle.jvmargs="-Xmx1536m"

      - name: Upload Test Results
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: backend-test-results
          path: build/test-results/test/*.xml

      - name: Upload JaCoCo Report
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: backend-jacoco-report
          path: build/jacoco/*.exec

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
          tags: |
            ${{ env.DOCKER_REGISTRY }}/${{ github.repository_owner }}/taskflow-backend:${{ env.IMAGE_TAG }}
            ${{ env.DOCKER_REGISTRY }}/${{ github.repository_owner }}/taskflow-backend:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Trivy Scan Backend
        if: ${{ github.event_name != 'workflow_dispatch' || inputs.run_security_scans }}
        uses: aquasecurity/trivy-action@v0.36.0
        with:
          image-ref: ${{ env.DOCKER_REGISTRY }}/${{ github.repository_owner }}/taskflow-backend:${{ env.IMAGE_TAG }}
          format: 'table'
          exit-code: '0'
          ignore-unfixed: true
          vuln-type: 'os,library'
          severity: 'HIGH,CRITICAL'

  frontend-pipeline:
    name: 🎨 Frontend (Build, Test & Containerize)
    runs-on: ubuntu-latest
    needs: changes
    if: ${{ github.ref == 'refs/heads/main' || github.event_name == 'workflow_dispatch' || needs.changes.outputs.frontend == 'true' }}
    permissions:
      contents: read
      packages: write
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v5

      - name: Setup Node.js
        uses: actions/setup-node@v5
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: 'frontend/package-lock.json'

      - name: Frontend - Angular Tests
        if: ${{ github.event_name != 'workflow_dispatch' || inputs.run_tests == true }}
        working-directory: ./frontend
        env:
          NODE_OPTIONS: --max-old-space-size=1536
        run: |
          npm ci
          echo "Running Vitest..."
          npm run test -- --watch=false

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
          tags: |
            ${{ env.DOCKER_REGISTRY }}/${{ github.repository_owner }}/taskflow-frontend:${{ env.IMAGE_TAG }}
            ${{ env.DOCKER_REGISTRY }}/${{ github.repository_owner }}/taskflow-frontend:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Trivy Scan Frontend
        if: ${{ github.event_name != 'workflow_dispatch' || inputs.run_security_scans }}
        uses: aquasecurity/trivy-action@v0.36.0
        with:
          image-ref: ${{ env.DOCKER_REGISTRY }}/${{ github.repository_owner }}/taskflow-frontend:${{ env.IMAGE_TAG }}
          format: 'table'
          exit-code: '0'
          ignore-unfixed: true
          vuln-type: 'os,library'
          severity: 'HIGH,CRITICAL'

```

## Step 4: Run the Workflow
* **Automatic Runs**: The pipeline will trigger seamlessly on code pushes and pull requests to the `main` branch.
* **Manual Runs (Parameterized)**: Go to the **Actions** tab in your repository, select the **TaskFlow Enterprise CI/CD** workflow on the left, and click **Run workflow**. You will be presented with the exact same interactive checkboxes for `run_lint_and_format`, `run_tests`, and `run_security_scans` that are available in Jenkins!

## 🚨 Troubleshooting

### Error: `denied: permission_denied: write_package` during `docker push`

If you encounter a `write_package` permission error when the workflow attempts to push the images to GHCR, it means GitHub Actions is being blocked from writing to your registry. 

**Solution 1: Check Repository Workflow Permissions**
1. Go to your GitHub repository -> **Settings** -> **Actions** -> **General**.
2. Scroll down to **Workflow permissions**.
3. Ensure **Read and write permissions** is selected and save.

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
        uses: docker/login-action@v4
     with:
       registry: ghcr.io
       username: ${{ github.actor }}
       password: ${{ secrets.CR_PAT }}
   ```
