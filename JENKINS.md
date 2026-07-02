# 🚀 TaskFlow High-Performance Jenkins CI/CD Setup Guide

This guide describes how to run and configure a high-performance, plugin-free Jenkins CI/CD pipeline using **Docker-in-Docker (DinD)**. This setup is fully optimized for **MacBook Pro M4** local development (via Rancher Desktop/Docker) but can be easily deployed on any standard Linux VPS or bare-metal environment.

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
3. **Retrieve the Initial Admin Password**:
   Run the following command to retrieve your Jenkins unlock key:
   ```bash
   docker logs my-jenkins 2>&1 | grep -A 5 "Jenkins initial setup required"
   ```

---

## 🔑 Step 2: Initial Jenkins Configuration

1. Open your browser and navigate to the mapped host port: **[http://localhost:8081](http://localhost:8081)**.
2. **Unlock Jenkins**: Paste the admin password retrieved from the docker logs in Step 1.
3. **Install Suggested Plugins**: Select the default **"Install suggested plugins"** option.
4. **No Custom Plugins Required**: Because our modern pipeline utilizes standard Docker CLI commands directly in standard shell (`sh`) blocks, **you do not need to install the "Docker Pipeline" or "JaCoCo" plugins!** This ensures a fast, bloat-free Jenkins footprint.

---

## 🔐 Step 3: Configure GitHub Container Registry (GHCR) Credentials

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

## 📂 Step 4: Create the Pipeline Project

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

## ⚡ Step 5: Run & Parameterize Your Pipeline

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

## 🛑 Step 6: Shutdown the Stack

If you are done playing with Jenkins and want to free up RAM/CPU resources on your MacBook Pro M4, simply run the stop script:

```bash
cd jenkins_docker_in_docker
./stop.sh
```
*All of your build logs, configuration keys, and persistent Docker layer caches will be safely preserved inside named volumes and ready for your next session!*
