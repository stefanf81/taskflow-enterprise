# 🚀 TaskFlow Jenkins CI/CD & Proxmox Deployment Guide

This is the ultimate, step-by-step master blueprint for taking the TaskFlow codebase and deploying it to a bare-metal Proxmox infrastructure. Because we are separating Jenkins from the production cluster, this setup will be incredibly clean, safe, and performant.

---

## Phase 1: Proxmox Infrastructure Provisioning
*(You can do this manually in the Proxmox UI or via Terraform).*

1. **Create VM 1 (The CI/CD Build Server):**
   * **OS:** Ubuntu 24.04 LTS
   * **Specs:** 8GB RAM, 4 to 6 vCPUs (AMD Ryzen 5 7430U), ~50GB Disk.
   * **Proxmox Tuning:** Set CPU Type to **`host`** (exposes your Ryzen AVX2 instructions). Set Disk Controller to **`VirtIO SCSI`**.
2. **Create VM 2 (The K3s Production Cluster):**
   * **OS:** Ubuntu 24.04 LTS
   * **Specs:** 8GB RAM, 4 to 6 vCPUs, ~30GB Disk.
   * **Proxmox Tuning:** Set CPU Type to **`host`**.

---

## Phase 2: Base OS Tuning (Run on BOTH VMs)
SSH into both VM 1 and VM 2, and run these commands to optimize Ubuntu for Docker/Kubernetes:

1. **Reduce Swappiness:**
   ```bash
   echo "vm.swappiness=10" | sudo tee -a /etc/sysctl.conf
   sudo sysctl -p
   ```
2. **Maximize CPU Governor (Optional but recommended):**
   ```bash
   sudo apt update && sudo apt install cpufrequtils -y
   echo 'GOVERNOR="performance"' | sudo tee /etc/default/cpufrequtils
   sudo systemctl restart cpufrequtils
   ```

---

## Phase 3: Setup VM 1 (Jenkins & Docker)
SSH into **VM 1** and execute the following:

1. **Install Docker:**
   ```bash
   curl -fsSL https://get.docker.com -o get-docker.sh && sudo sh get-docker.sh
   ```
2. **Install Java 21 & Jenkins:**
   ```bash
   sudo apt install fontconfig openjdk-21-jre -y
   sudo wget -O /usr/share/keyrings/jenkins-keyring.asc https://pkg.jenkins.io/debian-stable/jenkins.io-2023.key
   echo "deb [signed-by=/usr/share/keyrings/jenkins-keyring.asc] https://pkg.jenkins.io/debian-stable binary/" | sudo tee /etc/apt/sources.list.d/jenkins.list > /dev/null
   sudo apt update && sudo apt install jenkins -y
   ```
3. **Grant Docker Permissions (CRITICAL):**
   ```bash
   sudo usermod -aG docker jenkins
   ```
4. **Tune Jenkins RAM (Limit to 1GB):**
   * Open the systemd file: `sudo nano /lib/systemd/system/jenkins.service`
   * Find `Environment="JAVA_OPTS=..."` and change it to:
     `Environment="JAVA_OPTS=-Xms1g -Xmx1g -XX:+UseParallelGC -XX:+AlwaysPreTouch"`
   * Reload systemd: `sudo systemctl daemon-reload && sudo systemctl restart jenkins`

---

## Phase 4: Configure the Jenkins Pipeline
Open your browser and navigate to `http://<VM_1_IP>:8080`.

1. **Unlock Jenkins:** Follow the on-screen instructions (install suggested plugins).
2. **Install Docker Plugin:** Go to *Manage Jenkins > Plugins > Available plugins*. Search for and install **`Docker Pipeline`**.
3. **Create GitHub Credentials:** 
   * On GitHub, generate a Personal Access Token (PAT) with `write:packages` permissions.
   * In Jenkins, go to *Manage Jenkins > Credentials > Global*. Add a new "Username with password". Use your GitHub username and the PAT. Set the ID to **`github-ghcr-creds`**.
4. **Create the Pipeline:** 
   * Click "New Item" -> "Pipeline" -> Name it `TaskFlow-CI`.
   * Scroll down to "Pipeline script from SCM". Select Git, enter your public GitHub URL, specify `main` branch, and set Script Path to `Jenkinsfile`.

---

## Phase 5: Setup VM 2 (Production K3s)
SSH into **VM 2** to deploy your live Kubernetes environment:

1. **Install K3s:**
   ```bash
   curl -sfL https://get.k3s.io | sh -
   ```
2. **Extract Kubeconfig:**
   * Run `sudo cat /etc/rancher/k3s/k3s.yaml`.
   * Copy the contents to your local Mac (save it as `k3s-prod.yaml`). Change the `127.0.0.1` IP address inside the file to the IP address of VM 2.

---

## Phase 6: The Final Deployment
You are now ready to launch the entire stack!

1. **Build the Images:** Go to your Jenkins Web UI and click **"Build Now"**. Watch as Jenkins dynamically spins up containers, compiles your backend using AOT, tests everything, and pushes the ultra-lean Docker images to the GitHub Container Registry.
2. **Deploy to K3s:** From your local Mac, point `kubectl` to your new production cluster and deploy your application:
   ```bash
   export KUBECONFIG=k3s-prod.yaml
   kubectl apply -f kubernetes/namespace.yaml
   
   # Add your secrets (Replace passwords with secure values)
   kubectl create secret generic db-secret \
     --from-literal=POSTGRES_PASSWORD="production-secure-password" \
     --namespace=taskflow --dry-run=client -o yaml | kubectl apply -f -
     
   kubectl create secret generic backend-secret \
     --from-literal=SPRING_SECURITY_PASSWORD="admin-secure-password" \
     --namespace=taskflow --dry-run=client -o yaml | kubectl apply -f -
     
   # Deploy the rest of the application
   kubectl apply -f kubernetes/
   ```

Your enterprise-grade SaaS application is now live on your own bare-metal Proxmox homelab!