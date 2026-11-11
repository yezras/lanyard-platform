variable "name_prefix" {
  description = "Short lowercase prefix for Cognito resources. Example: lanyard-portal-staging."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,38}[a-z0-9]$", var.name_prefix))
    error_message = "name_prefix must be 3-40 chars, lowercase alphanumeric and hyphens."
  }
}

variable "environment" {
  description = "Logical environment label (tags only)."
  type        = string
  default     = "staging"
}

variable "tags" {
  description = "Additional tags."
  type        = map(string)
  default     = {}
}

variable "acknowledge_not_auto_applied" {
  description = "Must be true before planning. This module is infra_ready, not auto-applied to production."
  type        = bool
}
