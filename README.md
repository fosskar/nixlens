<!-- prettier-ignore -->
<div align="center">

<img src="./assets/logo/frosted-monogram.svg" alt="" align="center" height="88" />

# nOS

*A home screen and status overview for your NixOS machines*

[![NixOS module](https://img.shields.io/badge/NixOS-module-5277C3?style=flat-square&logo=nixos&logoColor=white)](#getting-started)
[![Go](https://img.shields.io/badge/Go-standard_library_only-00ADD8?style=flat-square&logo=go&logoColor=white)](./go.mod)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](./web/package.json)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

[Features](#features) • [Screenshots](#screenshots) • [How it works](#how-it-works) • [Getting started](#getting-started) • [Configuration](#configuration) • [Security](#security) • [Development](#development)

![nOS home screen with machine sidebar and app grid](./docs/screenshots/overview.png)

</div>

nOS is a single place to open your self-hosted apps and see how your machines are doing *right now*: which ones are up, how busy they are, and whether every pool and drive is healthy. Think of a homepage-style launcher paired with the storage view of a NAS operating system, built for NixOS and configured entirely in Nix.

> [!NOTE]
> nOS shows live state only. It keeps no history, draws no charts and sends no alerts. Pair it with a monitoring tool if you need those.

## Features

- **App home screen.** Apps declared in Nix, grouped into collapsible categories, with icons from [dashboard-icons](https://github.com/homarr-labs/dashboard-icons), [selfh.st](https://selfh.st/icons/) or [Material Design Icons](https://pictogrammers.com/library/mdi/).
- **App windows and a dock.** Apps open inside nOS and stay alive in the background, so switching is instant. Windows float or maximize above the dock. Apps that forbid framing are detected from their headers and open in a new tab instead.
- **Machines at a glance.** CPU, installed and used memory, swap by kind, load, uptime, NixOS version and kernel for every machine.
- **Storage that makes sense.** ZFS and md pools with their vdev layout, plain filesystems as volumes, and every physical drive drawn once. Hovering links pools and drives; popups show the vdev tree, datasets with quotas and snapshots, partition tables and SMART health.
- **SMART without waking drives.** Health, temperature, wear and sector counts, collected by a separate privileged oneshot that never spins up a sleeping disk.
- **Multi-machine.** One hub aggregates any number of agents over mutual TLS.
- **Groups from your SSO.** Behind a forward-auth proxy, admins see machines and storage while everyone else gets the app grid.
- **Read-only and small.** Agents never write to the system, run unprivileged under strict systemd hardening and do no work while nobody is looking.
- **Installable.** A web app manifest lets phones and desktops install nOS as an app.

## Screenshots

| Pool details | Drive details |
| --- | --- |
| ![ZFS pool popup with vdev tree, properties and datasets](./docs/screenshots/pool.png) | ![Drive popup with SMART values and partition table](./docs/screenshots/drive.png) |
| **App window** | **View for non-admins** |
| ![An app open in an nOS window above the dock](./docs/screenshots/app-window.png) | ![App grid without the admin sidebar](./docs/screenshots/user-view.png) |

<details>
<summary>On a phone</summary>

<img src="./docs/screenshots/mobile.png" alt="nOS on a narrow screen" width="320" />

</details>

> [!TIP]
> All screenshots use invented machines, drives and apps.

## How it works

```mermaid
flowchart LR
    browser["Browser or installed app"] --> proxy["Reverse proxy<br/>with forward auth"]
    proxy -- "Remote-User / Remote-Groups" --> hub["nOS hub<br/>UI and aggregation"]
    hub -- "mutual TLS" --> a1["agent<br/>vault"]
    hub -- "mutual TLS" --> a2["agent<br/>relay"]
    smart["nos-smart<br/>(oneshot, every 30 min)"] -. "/run/nos-smart" .-> a1
```

nOS is one Go binary built from the standard library only, with the React UI embedded:

- **Agent** (every machine): answers `/api/local/*` with system, storage and app data. It reads `/proc`, `/sys`, `lsblk`, `zpool` and `zfs` on request and keeps no state.
- **Hub** (one machine): serves the UI on loopback behind your reverse proxy, fetches its peers' data server-side and decides per app whether it may be framed. It reads the user's groups from the proxy's `Remote-*` headers.
- **SMART collector**: a separate oneshot with raw disk access writes `/run/nos-smart/smart.json`, so the agent itself never needs privileges.

## Getting started

You need NixOS with flakes. Add nOS as an input and import its module:

```nix
{
  inputs.nos = {
    url = "github:fosskar/nos";
    inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = { nixpkgs, nos, ... }: {
    nixosConfigurations.atlas = nixpkgs.lib.nixosSystem {
      modules = [
        nos.nixosModules.default
        ./configuration.nix
      ];
    };
  };
}
```

### A single machine

The hub also reports its own machine, so one host needs nothing else:

```nix
{
  services.nos = {
    enable = true;
    smart.enable = true;
    hub.enable = true;

    apps.Jellyfin = {
      url = "https://jellyfin.example.com";
      icon = "jellyfin.svg";
      category = "Media";
    };
    apps."Home Assistant" = {
      url = "https://home.example.com";
      icon = "home-assistant.svg";
      category = "Home";
    };
  };
}
```

Then put it behind your reverse proxy and its authentication, for example with Caddy and Authelia:

```caddy
nos.example.com {
	forward_auth 127.0.0.1:9091 {
		uri /api/authz/forward-auth
		copy_headers Remote-User Remote-Groups Remote-Name Remote-Email
	}
	reverse_proxy 127.0.0.1:7480
}
```

> [!IMPORTANT]
> The hub trusts the `Remote-*` headers of your proxy, so it must listen on loopback. The module enforces this with an assertion.

### Several machines

Every other machine runs an agent. Hub and agents authenticate each other with certificates from one private CA; agent certificates carry only the `serverAuth` usage and the hub's only `clientAuth`, so a certificate taken from one agent cannot read another. The openssl commands in [`nix/certs.nix`](./nix/certs.nix) create exactly these certificates.

```nix
# on each agent, e.g. vault
services.nos = {
  enable = true;
  smart.enable = true;
  listenAddress = "::";
  openFirewall = true;
  tls = {
    certFile = ./certs/vault.crt;      # serverAuth, names the host the hub dials
    keyFile = "/run/secrets/nos.key";  # never a nix store path
    caFile = ./certs/ca.crt;
  };
};

# on the hub
services.nos = {
  enable = true;
  hub.enable = true;
  hub.peers.vault = "https://vault.example.lan:7480";
  tls = {
    certFile = ./certs/hub.crt;        # clientAuth
    keyFile = "/run/secrets/nos.key";
    caFile = ./certs/ca.crt;
  };
};
```

### With clan

nOS ships a [clan](https://clan.lol) service that wires up roles, peers and certificates for you. The CA and per-machine certificates come from vars generators; the CA key is never deployed.

```nix
inventory.instances.nos = {
  module = {
    name = "@fosskar/nos";
    input = "nos";
  };
  roles.hub.machines.atlas = { };
  roles.agent.machines.vault = { };
  roles.agent.machines.relay = { };
};
```

The hub reaches each agent at `https://<machine>.<meta.domain>:7480`. Run `clan vars generate` before the first deployment.

## Configuration

| Option | Default | Description |
| --- | --- | --- |
| `services.nos.enable` | `false` | Run the agent, which reports this machine's state. |
| `services.nos.listenAddress` | `"127.0.0.1"` | Address to listen on. A hub must stay on loopback. |
| `services.nos.port` | `7480` | Port to listen on. |
| `services.nos.openFirewall` | `false` | Open the port in the firewall. |
| `services.nos.apps.<name>` | `{ }` | Apps on this machine: `url`, `icon`, `category` (default `"Apps"`) and `description`. |
| `services.nos.smart.enable` | `false` | Collect SMART health every 30 minutes without waking sleeping drives. |
| `services.nos.tls.{certFile,keyFile,caFile}` | `null` | Certificates for mutual TLS between hub and agents. |
| `services.nos.hub.enable` | `false` | Serve the UI and aggregate this machine with its peers. |
| `services.nos.hub.peers.<name>` | `{ }` | Agents to show, by machine name and base URL. |
| `services.nos.hub.categories` | `[ ]` | Categories listed first, in this order; the rest follow alphabetically. |
| `services.nos.hub.adminGroups` | `[ ]` | Groups that see machines and storage. Empty allows everyone. |
| `services.nos.hub.categoryGroups.<category>` | `{ }` | Groups that see a category. Unlisted categories are visible to all. |

An app's `icon` can be a dashboard-icons file or name (`jellyfin.svg`), a selfh.st icon (`sh-jellyfin`), a Material Design icon (`mdi-printer`) or a URL.

## Security

- **Read-only agents.** The agent runs as a `DynamicUser` with an empty capability set, a read-only file system, a system call allow-list, closed device access apart from `/dev/zfs`, and memory and task limits. `systemd-analyze security` rates it 1.5.
- **Privileged parts are isolated.** Reading installed memory from SMBIOS runs once in a privileged `ExecStartPre`. SMART runs in `nos-smart.service` with only `CAP_SYS_RAWIO` and `CAP_SYS_ADMIN`, read-only disk access and no network.
- **Transport.** Mutual TLS 1.3 between hub and agents, with role-bound certificates. Keys reach the services through `LoadCredential` and may not live in the Nix store.
- **Browser.** The UI is served with a strict Content Security Policy and `frame-ancestors 'none'`.

> [!WARNING]
> An agent listening beyond loopback without `services.nos.tls` serves its system and storage data to anyone who can reach the port. The module warns about this configuration.

## Development

```bash
nix develop

# backend
go test ./...
go build -o nos . && ./nos -hub

# frontend with hot reload, proxying /api to a hub on 127.0.0.1:7480
cd web && npm install && npm run dev

# two-node NixOS VM test: mTLS, ZFS, SMART, groups and apps
nix build .#checks.x86_64-linux.nixos-test
```

The UI is embedded into the binary from `web/dist`, so run `npm run build` before `go build`. `nix build` does both.
