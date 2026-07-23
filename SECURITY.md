# Security policy

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting flow from the repository's
Security tab. Include the affected command or module, a minimal reproduction,
and the impact you observed.

Keep credentials, access tokens, private URLs, and user content out of public
issues. Security reports will receive an initial acknowledgement as capacity
allows. Confirmed fixes will be documented in the changelog or a security
advisory.

## Deployment safety

DropHere publishes the selected directory to a public URL. Run the included
preflight checks and point the CLI at generated static output such as `dist`,
`build`, or `out`. The CLI refuses common credential filenames, while every
publisher remains responsible for reviewing the final file list.
