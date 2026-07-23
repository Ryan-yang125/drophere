# Public source boundary

This repository contains:

- the DropHere Agent Skill and its deterministic helper scripts;
- the DropHere command-line client;
- the browser-safe deployment core;
- public examples, tests, and project governance.

The hosted API, account dashboard, service administration, and Cloudflare
infrastructure remain in a separate operational repository. The free hosted
service is available at `https://drophere.page` and can evolve independently
from client releases.

This boundary keeps service credentials, abuse controls, and production
operations outside the distributable client. Public issues and pull requests
should focus on the files present in this repository.
