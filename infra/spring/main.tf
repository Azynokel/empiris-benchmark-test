terraform {
  required_version = "~> 1.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 3.0"
    }
  }
}

provider "google" {
  project = var.gcp_project
  region  = var.gcp_region
}

# Create VPC network
resource "google_compute_network" "empiris-network" {
  name = "empiris-network"
}


# Create static IP
resource "google_compute_address" "tf-ip" {
  name = "tf-ip"
}

# Setup compute instance in GCP
resource "google_compute_instance" "tf-instance" {
  name = "spring-instance"
  # machine_type = "e2-medium"
  machine_type = "n2-highcpu-4"
  zone         = var.gcp_zone

  # Tag the instance so we can apply firewall rules to it
  tags = ["empiris-instance"]

  boot_disk {
    initialize_params {
      image = "projects/debian-cloud/global/images/debian-12-bookworm-v20240709"
    }
  }

  network_interface {
    network = google_compute_network.empiris-network.name
    access_config {
      # Allow access to http and https
      nat_ip = google_compute_address.tf-ip.address
    }
  }


  metadata_startup_script = file("setup.sh")
}

# Setup firewall rule to allow access to port for postgres
resource "google_compute_firewall" "tf-firewall" {
  name    = "tf-firewall"
  network = google_compute_network.empiris-network.name

  allow {
    protocol = "tcp"
    ports    = ["8080", "8090", "22"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["empiris-instance"]
}

# Output the IP address
output "ip" {
  value = google_compute_address.tf-ip.address
}