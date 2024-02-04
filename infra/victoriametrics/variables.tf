# Required variables
variable "gcp_project" {
  description = "GCP project id"
}

variable "gcp_region" {
  description = "GCP region"
  default     = "europe-west1"
}

variable "gcp_zone" {
  description = "GCP zone"
  default     = "europe-west1-b"
}
