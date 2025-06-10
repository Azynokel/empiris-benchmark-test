# use the official Bun image
# see all versions at https://hub.docker.com/r/oven/bun/tags
FROM node:19-bullseye AS base
WORKDIR /usr/src/app

# Install bun
RUN curl -fsSL https://bun.sh/install | bash

Install Go
ENV GO_VERSION=1.21.1
RUN apt-get update && \
    apt-get install -y wget tar && \
    wget https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz && \
    tar -C /usr/local -xzf go${GO_VERSION}.linux-amd64.tar.gz && \
    rm go${GO_VERSION}.linux-amd64.tar.gz

# Set up PATH for both Bun and Go
ENV PATH="/usr/local/go/bin:/root/.bun/bin:${PATH}"
# ENV PATH="${PATH}:/root/.bun/bin"

# install dependencies into temp directory
# this will cache them and speed up future builds
FROM base AS install

# Install bun
RUN curl -fsSL https://bun.sh/install | bash

RUN mkdir -p /temp/dev
COPY package.json bun.lockb /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

# install with --production (exclude devDependencies)
RUN mkdir -p /temp/prod
COPY package.json bun.lockb /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

# copy node_modules from temp directory
# then copy all (non-ignored) project files into the image
FROM base AS prerelease
COPY --from=install /temp/dev/node_modules node_modules
COPY . .

ENV NODE_ENV=production
#RUN bun build src/index.ts --target bun --outdir ./dist

# copy production dependencies and source code into final image
#FROM base AS release
#COPY --from=install /temp/prod/node_modules node_modules
#COPY --from=prerelease /usr/src/app/dist ./dist
#COPY --from=prerelease /usr/src/app/package.json .

# run the app
#USER bun
ENTRYPOINT [ "bun", "run", "/usr/src/app/src/index.ts" ]