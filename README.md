# EMPIRIS: Benchmarking GitHub Action

Welcome to EMPIRIS, a comprehensive benchmarking Github action designed to evaluate the performance and efficiency of systems across an increasing range of qualities. EMPIRIS aims to equip developers, researchers, and organizations with the insights needed to optimize their solutions for better performance and scalability.

## Features

- Application & Microbenchmark Support: We support tsbs, inch and go microbenchmarks
- Designed to be extended
- Run Benchmarks in your Cloud

## Get Started

This section will guide you through the process of setting up EMPIRIS for use in your projects.

### SUT

We assume that the SUT is provisioned as part of a CI/CD pipeline using the user's favorable infrastructure provisioning like Terraform. We don't impose any abstractions, such that the SUT can be set up as a simple docker container or a Kubernetes Cluster. Depending on the benchmarking client we just assume that the SUT can be reached.

### Configuration File Breakdown

The configuration is YAML-formatted, which is human-readable and widely used for configuration files.
It utilizes placeholders (e.g., {{ $env.variable_name }}) for sensitive or environment-specific values.

**Go Microbenchmarks in its simplest form:**

```yaml
name: Go Microbenchmark
application: go

benchmark:
  tool: go
  workdir: examples/go
  package: fib

platform: # Optional here, the local platform is default. The benchmark will run in the Github Action VM
  on: local
```

**A more advanced Go example:**

```yaml
name: Go Microbenchmark
application: go

benchmark:
  tool: go
  workdir: examples/go
  package: fib
  optimization: true # This enables a call graph based optimization

# The benchmarks will run in a cloud instance
platform:
  on: gcp-vm
  project: empiris
  instance:
    machine_type: n2-highcpu-4
  auth:
    service_account: "{{ $env.service_account }}"
    ssh:
      private_key: "{{ $env.ssh_private_key }}"
      public_key: "{{ $env.ssh_public_key }}"

visualization:
  api_key: "{{ $env.api_key }}" # Visit empiris.pages.dev to obtain an API Key

github_token: "{{ $env.github_token }}" # The Github Token is required for optimizating the Go benchmarks
```

**An inch application benchmark:**

```yaml
name: Influx Benchmark
application: influxdb

benchmark:
  tool: inch
  # Settings like benchmark duration etc. fall back to reasonable defaults here
  version: 2
  influx_token: "{{ $env.influx_token }}"
  host: "{{ $env.influx_host }}"
  database: test

platform:
  on: gcp-vm
  project: empiris
  instance:
    machine_type: n2-highcpu-4
  auth:
    service_account: "{{ $env.service_account }}"
    ssh:
      private_key: "{{ $env.ssh_private_key }}"
      public_key: "{{ $env.ssh_public_key }}"

visualization:
  api_key: "{{ $env.api_key }}"
```

## Run the Examples

## Known Issues

## Future Work

- More Adapters like Artillery (currently wip)
- VPC Peering
- Scalable and Distributed Benchmarking Clients
- Duet Benchmark
- Optimizations for Cloud Ressource Provisioning

## Development

To get started with developing we assume you have the latest version of NodeJS installed.

Enable pnpm:

```sh
corepack enable
```

Build the action:

```sh
pnpm build
```

In watch mode:

```sh
pnpm build --watch
```

Depending on the example you want to run you should also have a .env secret file.

For local testing, you can use act.

```sh
act push --secret-file .env
```

### Bring your adapters

This is the current work in progress of the artillery adapter and it shows quite well how an adapter is structured and developed. An adapter must have a unique name and a config schema for the empiris.yaml file. The adapter can optionally define dependencies and the EMPIRIS framework will ensure that those dependencies are available when the benchmark is setting up and running. Every adapter must implement a setup and a run method. It receives the options specified in the empiris.yaml, as well as an exec function. The exec function ensures compatibility across different platform runtimes, such that the adapters must not worry about cloud infrastructure etc.

```typescript
import * as core from "@actions/core";
import { createAdapter } from "../types";
import { z } from "zod";

export const artilleryAdapter = createAdapter({
  tool: "artillery",
  dependsOn: ["node"],
  config: z.object({
    configPath: z.string().optional().default("artillery.yaml"),
  }),
  setup: async ({ exec }) => {
    const result = await exec("npm install -g artillery@latest");

    if (!result.success) {
      return {
        success: false,
        error: "Failed to install artillery",
      };
    }

    return { success: true };
  },
  run: async ({ exec, options: { configPath } }) => {
    core.info(`Running Artillery with config ${configPath}`);

    const result = await exec(`artillery run ${configPath}`);

    if (!result.success) {
      return [];
    }

    // Parse the benchmarks output into metrics
    core.info(result.stdout);
    // Return metrics
    return [];
  },
});

export type ArtilleryAdapter = typeof artilleryAdapter;
```
