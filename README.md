# spz-crew

> Crew dashboard and crew radio.

![version](https://img.shields.io/badge/version-1.1.1-ff6200) ![SPiceZ-Core](https://img.shields.io/badge/SPiceZ--Core-beta-18181b)

## Overview

A dashboard to create, browse and join crews, manage the roster, kick and disband, plus a crew voice radio (pma-voice).

## Features

- Create / browse / join crews
- Roster management
- Crew radio

## Requirements

| Resource | Type |
|---|---|
| `ox_lib` | third-party |
| `oxmysql` | third-party |
| `spz-core` | SPiceZ module |
| `spz-identity` | SPiceZ module |
| `pma-voice` | third-party |

## Installation

Included in the [txAdmin recipe](https://github.com/SPiceZ21/spz-txrecipe). Manual install:

1. Download `spz-crew` from GitHub (latest release, or the repository) into your `resources` folder.
2. Add to `server.cfg`, after its requirements:

```cfg
ensure spz-crew
```

## Commands

| Command | Who | Description |
|---|---|---|
| `/crew` | player | Open the crew dashboard |
| `/crewradio` | player | Toggle crew radio |

## Key binds

Rebindable in **Settings → Key Bindings → FiveM**.

| Action | Default |
|---|---|
| Open crew dashboard | _unbound_ |
| Toggle crew radio | _unbound_ |

---

Part of **SPiceZ-Core** — [documentation](https://github.com/SPiceZ21/Docs) · [all modules](https://github.com/SPiceZ21/Docs/blob/main/modules/README.md)
