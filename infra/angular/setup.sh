#!/usr/bin/env bash

exec > >(tee -a /var/log/startup.log) 2>&1
echo "Starting startup script"

status () {
	printf "$1\n\n" > /root/status.md
}

def_alias () {
	echo "alias $1=\"$2\"" >> /root/.bash_aliases
}

status "Started Script, installing base packages"

apt update > /dev/null || { status "Initial update failed" && exit; }
apt install -y vim git btop netcat-openbsd > /dev/null || { status "Install of base packages failed" && exit; }
curl -sL portal.spatiumportae.com | bash

status "Install done, generating files"

echo "source /root/.bash_aliases" > /root/.bashrc

echo "alias v=\"vim ./\"" > /root/.bash_aliases
def_alias "w" "watch \\\"cat status.md\\\""
def_alias "l" "watch ls"
def_alias "cl" "clear"
def_alias "la" "ls -a"
def_alias "log" "tail /var/log/startup.log"
def_alias "status" "cat /root/status.md"

status "Generating slices"

# Slices are inclusive
printf "[Slice]\nAllowedCPUs=0-2\nMemoryMax=4G\n\n" > /etc/systemd/system/first.slice
printf "[Slice]\nAllowedCPUs=3-5\nMemoryMax=4G\n\n" > /etc/systemd/system/second.slice

status "Generated slices, reloading systemd"

systemd daemon-reload

status "Installing Docker"

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt update > /dev/null || { status "Docker update failed" && exit; }

apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin > /dev/null || { status "Install of Docker plugins failed" && exit; }

status "Installed Docker and plugins, cloning sut"

cd /root/
REPO_URL="https://github.com/SWC-EMPIRIS/angular-benchmark.git"
BRANCH="main"

git clone --depth 1 --branch $BRANCH $REPO_URL new
git clone --depth 2 --branch $BRANCH $REPO_URL old

git -C /root/old checkout HEAD~1

status "Cloned sut, building containers"

cd /root/new
docker build -t sut:new .

cd /root/old
docker build -t sut:old .

status "Built containers, starting them"

docker run -d -p 8080:8080 \
	-e PORT=8080 \
	--name sys_one \
	--cgroup-parent first.slice \
	sut:new

docker run -d -p 8090:8080 \
	-e PORT=8080 \
	--name sys_two \
	--cgroup-parent second.slice \
	sut:old