# EMPIRIS: Continuous Benchmarking GitHub Action

Welcome to EMPIRIS, a comprehensive benchmarking Github action designed to evaluate the performance and efficiency of systems across an increasing range of qualities. EMPIRIS aims to equip developers, researchers, and organizations with the insights needed to optimize their solutions for better performance and scalability.

## Features

- Application & Microbenchmark Support: We support tsbs, inch and go microbenchmarks
- Designed to be extended
- Run Benchmarks in your Cloud

## Get Started

This section will guide you through the process of setting up EMPIRIS for use in your projects.

### SUT

We assume that the SUT is provisioned as part of a CI/CD pipeline using the user's favorable infrastructure provisioning like Terraform. We don't impose any abstractions, such that the SUT can be set up as a simple docker container or a Kubernetes Cluster. Depending on the benchmarking client we just assume that the SUT can be reached.

### Action Setup

```yaml
name: Minimal setup
on:
  push:

jobs:
  benchmark:
    name: Performance regression check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
        # https://stackoverflow.com/questions/60052236/git-diff-gives-me-a-fatal-bad-revision-head1
        with:
          fetch-depth: 5
      - uses: actions/setup-go@v4
	  	with:
		  go-version: "stable"
      - name: Run Benchmark
        uses: ./
        with:
          config_path: empiris.yaml
        env:
          api_key: ${{ secrets.EMPIRIS_API_KEY }}
          service_account: ${{ secrets.GOOGLE_CREDENTIALS }}
          ssh_private_key: ${{ secrets.CLOUD_SSH_PRIVATE_KEY }}
          ssh_public_key: ${{ secrets.CLOUD_SSH_PUBLIC_KEY }}
```

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
  # Settings like benchmark duration etc. fall back to reasonable defaults here but could also be specified
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

### Visualization

The metrics obtained from a benchmark experiment can stored and visualized via our service `empiris.pages.dev`,
however, this is optional and we also write the results under `report.json`. You can bring your own analysis and visualization based on the `report.json`.

### Complete Example

Under `.github/workflows/test.yml` you can find a complete working example including SUT provisioning. You can take this as a starting point for your own setup.

## Known Issues

- The TSBS Adapter can currently run in a cloud environment and only victoriametrics. In the GitHub action's VM we experience unexpected behavior that requires further analysis.

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

For local testing, you can use [act](https://github.com/nektos/act).

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
