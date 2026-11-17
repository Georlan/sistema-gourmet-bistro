# Build dependency for file matching

This private fork contains the MIT-licensed runtime files of picomatch 4.0.7 from the npm registry. The source tarball has the following integrity value.

    sha512-qcJu88Q2IWqJsDD529JKMdwGm/dvInW4HvQnRwiH9JtihJvzGOscDtHE3x1pBKeUOTysQ8kVmLnJ2kJu7yhcGA==

The only change to the upstream JavaScript is in lib/parse.js. The parser rejects both repeated extglob operators when it recognizes the opening operator, before building a regular expression. Current project build patterns use ordinary glob stars, globstars, braces and non-repeating groups. Build configurations requesting repeated extglobs receive a syntax error.

The root npm override applies the same local implementation to Vite, tinyglobby and fdir. When upstream publishes a reviewed fix for GHSA-fc5q-39xc-vjpf, replace the override and this directory with the fixed dependency and rerun the matcher, build and browser checks. Track advisories against the upstream package while this fork is in use.

[Upstream project](https://github.com/micromatch/picomatch) · [Advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)
