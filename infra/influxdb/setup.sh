# Add Docker's official GPG key:
sudo apt-get update -y
sudo apt-get install ca-certificates curl gnupg -y
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Add the repository to Apt sources:
echo \
  "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  "$(. /etc/os-release && echo "$VERSION_CODENAME")" stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update -y

sudo apt-get install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin -y

sudo docker run -d -p 80:8086 -e DOCKER_INFLUXDB_INIT_MODE=setup -e DOCKER_INFLUXDB_INIT_USERNAME=admin -e DOCKER_INFLUXDB_INIT_PASSWORD=12345678 -e DOCKER_INFLUXDB_INIT_ORG=test -e DOCKER_INFLUXDB_INIT_BUCKET=test -e DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=PdomKtCYz_r7ym9yAcHMzxCA57lwyTkAWiwUbVk4sXePLU5eAckk9J-K6pygGWODRq3t_gFrcsGQNhmJ7Y9HNw== -v myInfluxVolume:/var/lib/influxdb2 influxdb:latest