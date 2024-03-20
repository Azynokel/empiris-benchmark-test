# EMPIRIS: Continuous Benchmarking GitHub Action

Welcome to EMPIRIS, a comprehensive benchmarking Github action designed to evaluate the performance and efficiency of systems across an increasing range of qualities. EMPIRIS aims to equip developers, researchers, and organizations with the insights needed to optimize their solutions for better performance and scalability.

## Features

- Continuous Application Benchmarks with inch and tsbs
- Continuous Micro Benchmarks with Go and randomized multiple interleaved trials (RMIT)
- Run Benchmarks in your Cloud
- Designed to be extended
- Integrated visualization with [empiris.pages.dev](https://empiris.pages.dev) and analysis with our [analysis action](https://github.com/ADSP-EMPIRIS/analysis-action) but also open for your own implementations

## Get Started

This section will guide you through the process of setting up EMPIRIS for use in your projects.

### SUT

We assume that the SUT is provisioned as part of a CI/CD pipeline using your most favorable infrastructure provisioning. We don't impose any abstractions, such that the SUT can be set up as a simple docker container or a Kubernetes Cluster. Depending on the benchmarking client we just assume that the SUT can be reached.

### Action Setup

```yaml
name: Minimal setup
on:
  push:

jobs:
  benchmark:
    name: Benchmark
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
        # https://stackoverflow.com/questions/60052236/git-diff-gives-me-a-fatal-bad-revision-head1
        with:
          fetch-depth: 5

      - uses: actions/setup-go@v4
        with:
          go-version: "stable"

      # {INSERT YOUR SYSTEM UNDER TEST PROVISIONING HERE}

      - name: Run Benchmark
        uses: ADSP-EMPIRIS/benchmark-gh-action@main
        with:
          config_path: empiris.yaml
        env:
          api_key: ${{ secrets.EMPIRIS_API_KEY }}
          service_account: ${{ secrets.GOOGLE_CREDENTIALS }}
          ssh_private_key: ${{ secrets.CLOUD_SSH_PRIVATE_KEY }}
          ssh_public_key: ${{ secrets.CLOUD_SSH_PUBLIC_KEY }}
```

### Configuration File Breakdown

The `empiris.yaml` configuration is used to further specify the benchmark.
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
    copy:
      - local: examples/go
        remote: examples/go
  auth:
    service_account: "{{ $env.service_account }}"
    ssh:
      private_key: "{{ $env.ssh_private_key }}"
      public_key: "{{ $env.ssh_public_key }}"

visualization:
  api_key: "{{ $env.api_key }}" # Visit empiris.pages.dev to obtain an API Key

# The Github Token is required for optimizing the Go benchmarks
# The token should be allowed to read/write artifacts and read previous action runs
github_token: "{{ $env.github_token }}"
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

The metrics obtained from a benchmark experiment can be stored and visualized via our service [empiris.pages.dev](https://empiris.pages.dev),
however, this is optional and we also write the results under `report.json`. You can bring your own visualization based on the `report.json`.

### Analysis

Similarly to the visualization we provide our own implementation for an [analysis action](https://github.com/ADSP-EMPIRIS/analysis-action) or you can bring your own via the `report.json`.

### Complete Example

Under `.github/workflows/test.yml` you can find a complete working example including SUT provisioning. You can take this as a starting point for your own setup.

## Known Issues

- The TSBS Adapter can currently only run in a cloud environment with victoriametrics. In the GitHub action's VM we experience unexpected behavior that requires further analysis.

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

Depending on the example you want to run you should also have a .env secret file, you can start from the `env.example`.

For local testing, you can use [act](https://github.com/nektos/act).

```sh
act push --secret-file .env
```

### Bring your adapters

This is the current work in progress of the artillery adapter and it shows quite well how an adapter is structured and developed. An adapter must have a unique name and a config schema for the empiris.yaml file. The adapter can optionally define dependencies and the EMPIRIS framework will ensure that those dependencies are available when the benchmark is setting up and running. Every adapter must implement a setup and a run method. It receives the options specified in the empiris.yaml, as well as an exec function. The exec function ensures compatibility across different platform runtimes, such that the adapters must not worry about cloud infrastructure.

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

    // Parse the benchmarks output into metrics (needs to be implemented)
    core.info(result.stdout);
    // Return metrics
    return [];
  },
});

export type ArtilleryAdapter = typeof artilleryAdapter;
```

## Next Steps

- More Adapters like Artillery (currently wip)
- Duet Benchmarking
- VPC Peering
- Scalable and Distributed Benchmarking Clients
- Optimizations for Cloud Ressource Provisioning

## Related Work

Some design decisions were inspired by [https://github.com/benchmark-action/github-action-benchmark](https://github.com/benchmark-action/github-action-benchmark). While the implementation differs significantly, you might see some
similarities in the configuration specification.
