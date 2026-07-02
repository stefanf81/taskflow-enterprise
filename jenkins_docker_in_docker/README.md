# Install Jenkins using Docker Compose

This repository contains a Docker Compose configuration for a quick installation of Jenkins. This setup is not intended for production systems.

Credits: This approach is mostly based on the [official instructions](https://www.jenkins.io/doc/book/installing/docker/) but takes advantage of Docker Compose (by using a `docker-compose.yml` file) to reduce the number of steps needed to get Jenkins up and running.

# Docker Installation

## Step 0

Install Docker locally (probably using Docker Desktop is the easiest approach).

## Step 1

Clone this repository or download its contents. 

## Step 2

Start Jenkins. The `./start.sh` script will automatically build your customized Jenkins image (with `docker-ce-cli` pre-installed), set persistent BuildKit volume caches, configure logging limits, and spin up the daemon:

```
./start.sh
```

## Step 3 (Retrieve Admin Password)

To unlock Jenkins, you need the initial admin password. You can retrieve it in one of two ways:

*   **Option A (Via Docker Logs)**:
    ```bash
    docker logs my-jenkins
    ```
    *Look for the block of asterisks `*********************************` in the console log containing the 32-character hex password.*

*   **Option B (Directly from Container File)**:
    ```bash
    docker exec my-jenkins cat /var/jenkins_home/secrets/initialAdminPassword
    ```

## Step 4

Open Jenkins by going to: [http://localhost:8081/](http://localhost:8081/) and paste the retrieved password to finish the installation process.

## Step 5

If you wish to stop Jenkins and get back to it later, simply run the stop script:

```
./stop.sh
```

If you wish to start Jenkins again later, just run the same command from Step 2.


# Removing Jenkins

Once you are done playing with Jenkins, maybe it is time to clean things up.

Run the following command to terminate Jenkins and to remove all volumes and images used:

```
docker compose down --volumes --rmi all 
```
