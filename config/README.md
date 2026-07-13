# Enterprise Configuration

This directory contains deployment-specific settings for the enterprise layer.
Keep organization and brand values here instead of hardcoding them in OpenSign
source files.

The custom layer reads these files from the repository root. In production,
prefer overriding sensitive values with environment variables and secret
management rather than committing secrets.
