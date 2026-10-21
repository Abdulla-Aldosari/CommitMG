All notable changes to **[CommitMG](https://github.com/Abdulla-Aldosari/CommitMG)** are documented here.<br>

## [unreleased]

### 🚀 Features

- _(ai)_ Add Ollama as a local AI provider option - ([2b7492c](https://github.com/Abdulla-Aldosari/CommitMG/commit/2b7492c49ae079ec1d8e8226cf6e6dccc6ccfd06))
- _(ai)_ Choose reasoning effort, temperature and output cap - ([6a80777](https://github.com/Abdulla-Aldosari/CommitMG/commit/6a80777e610aeb82155bb1dd163af3d8b44b3ebd))
- _(dev)_ Record run settings and replies in dev sessions - ([1727c94](https://github.com/Abdulla-Aldosari/CommitMG/commit/1727c942c9c4326531d77634470b451f9269a59d))
- _(generation)_ Offer a plain summary without type or scope - ([a65a88d](https://github.com/Abdulla-Aldosari/CommitMG/commit/a65a88dcc5e144448bda5e61a364a4d514d13745))
- _(generation)_ Add the type's emoji to the header - ([1bd1775](https://github.com/Abdulla-Aldosari/CommitMG/commit/1bd177545fb4df587bd449b80ed5c7c5a968f68a))
- _(generation)_ Add the user's extra instructions to the prompt - ([94ea046](https://github.com/Abdulla-Aldosari/CommitMG/commit/94ea04649db3f77a916a6016e3c376da92e2f55a))
- _(generation)_ Choose scope policy and bullet spacing - ([6e979a4](https://github.com/Abdulla-Aldosari/CommitMG/commit/6e979a4903cfe730f118a83fdb966972a9adf259))
- _(generation)_ Read project rules from .commitmgrc.json - ([4a1ee40](https://github.com/Abdulla-Aldosari/CommitMG/commit/4a1ee40dade3636fdda498ea79ee48b7acaf2c7a))
- _(generation)_ Follow commitlint extends to installed configs - ([12fe4bb](https://github.com/Abdulla-Aldosari/CommitMG/commit/12fe4bb11b1a0e21727cbb33035395098b3fb1a9))
- _(generation)_ Read commitlint configs in every JS and JSON format - ([9f4dc35](https://github.com/Abdulla-Aldosari/CommitMG/commit/9f4dc35cb924697aa195dba6945673bdb4feeeb3))
- _(generation)_ Make the request timeout configurable - ([edfc601](https://github.com/Abdulla-Aldosari/CommitMG/commit/edfc601eb8774291b7fa9fe46b72a320e250c0f3))
- _(generation)_ Let users turn off the correction retry - ([31783f0](https://github.com/Abdulla-Aldosari/CommitMG/commit/31783f0bc937085c3ac263207944c8e56532ede7))
- _(generation)_ Offer a compact type guide - ([4c111b4](https://github.com/Abdulla-Aldosari/CommitMG/commit/4c111b4afbc5f7ed42fcbee7326c1d325bbd7fe1))
- _(generation)_ Leave generated files out of the diff - ([73ee35d](https://github.com/Abdulla-Aldosari/CommitMG/commit/73ee35da69e67450367980337546e2ae9e8b4f2e))
- _(generation)_ Set diff context lines and ignore whitespace changes - ([4675e6d](https://github.com/Abdulla-Aldosari/CommitMG/commit/4675e6d134ef27757198f890f3615c3670d9c856))
- _(generation)_ Share the diff budget fairly across files - ([849d2f6](https://github.com/Abdulla-Aldosari/CommitMG/commit/849d2f69c0d6c2a46767effd574af14b2e5c14f3))
- _(generation)_ Cancel commit message generation - ([ac7148a](https://github.com/Abdulla-Aldosari/CommitMG/commit/ac7148abdac6cf8cf09cc2accfebf49a6577ebb1))
- _(settings)_ Add developer tab for measuring model capabilities - ([218312f](https://github.com/Abdulla-Aldosari/CommitMG/commit/218312f656910b9cb192747fdbe0e14f469131dd))
- _(settings)_ Start the rules file from the Angular convention - ([12d1337](https://github.com/Abdulla-Aldosari/CommitMG/commit/12d1337ba72041cbd1cca67bad3069ce9fc29735))
- _(settings)_ Add a Message Format tab - ([35dc1f5](https://github.com/Abdulla-Aldosari/CommitMG/commit/35dc1f5d675527503b8510b4bcf5b8c55cfaed28))
- _(settings)_ Generate with a default detail level - ([662efd1](https://github.com/Abdulla-Aldosari/CommitMG/commit/662efd1ed6a888a2215d789fc4186d1e7cf1bd9f))
- _(settings)_ Add a Rules tab - ([c99a8c2](https://github.com/Abdulla-Aldosari/CommitMG/commit/c99a8c2716ad8e0a6cedd59f4252f533fc02ca36))
- _(settings)_ Add a Speed & Context tab with context size presets - ([f8e514c](https://github.com/Abdulla-Aldosari/CommitMG/commit/f8e514c7bee3b36286aa69d08b161d2082a3b42a))
- _(webview)_ Show the prompt size the settings produce - ([322c566](https://github.com/Abdulla-Aldosari/CommitMG/commit/322c5665c14d9c167237fa3a0537b36195833260))

### 🐛 Bug Fixes

- _(ai)_ Reject replies cut off by the output limit - ([8a223dd](https://github.com/Abdulla-Aldosari/CommitMG/commit/8a223ddef77fe2cc95baa5d610848b3846b60b9d))
- _(ai)_ Refresh the built-in model lists and defaults - ([fd381e4](https://github.com/Abdulla-Aldosari/CommitMG/commit/fd381e4250b52696a1011d45649fd5a63e133212))
- _(ai)_ Read Mistral replies when the model reasons - ([608ed61](https://github.com/Abdulla-Aldosari/CommitMG/commit/608ed612c80ac130eb4921900b3fbf3968d071d3))
- _(ai)_ Stop sending parameters that a model rejects - ([55e3325](https://github.com/Abdulla-Aldosari/CommitMG/commit/55e33253a7fa697d68b636c8127b54d8a416a653))
- _(ai)_ Hide models that cannot generate commit messages - ([3f899c9](https://github.com/Abdulla-Aldosari/CommitMG/commit/3f899c92b735f1fe619f2cd8acb42a2888a95593))
- _(ai)_ Strip query strings from URLs in error messages - ([47ee3a9](https://github.com/Abdulla-Aldosari/CommitMG/commit/47ee3a9ee0ddd2d4a93f7e5e944d3775a7b77d7a))
- _(ai)_ Send the Gemini API key in a header instead of the URL - ([c960683](https://github.com/Abdulla-Aldosari/CommitMG/commit/c96068386a177b645e43cbcff998d4c19d106212))
- _(generation)_ Take the allowed commit types from the project rules - ([41405af](https://github.com/Abdulla-Aldosari/CommitMG/commit/41405af06e2242bd969def34d9cba5650538ab8c))
- _(generation)_ Teach length limits up to 100 characters - ([0ce84f8](https://github.com/Abdulla-Aldosari/CommitMG/commit/0ce84f84e7421dcdfa1678e1b675a4075bd084e6))
- _(generation)_ Flag messages without a conventional header - ([a153cd7](https://github.com/Abdulla-Aldosari/CommitMG/commit/a153cd7907998e781a225d887a4018721eaf1f06))
- _(generation)_ Allow commitlint configs without a scope-enum rule - ([1f8e9b8](https://github.com/Abdulla-Aldosari/CommitMG/commit/1f8e9b8174f45d250b10d69636cc64d1ae6b6e9b))
- _(generation)_ Load commitlint config in an isolated process - ([53119a3](https://github.com/Abdulla-Aldosari/CommitMG/commit/53119a391d13644cb7c756d736331fb871942d11))
- _(generation)_ Handle non-ASCII file paths in evidence and scopes - ([85b61d0](https://github.com/Abdulla-Aldosari/CommitMG/commit/85b61d054d3684d94cfc7e29e162b692260b42da))
- _(generation)_ Run git without a shell to block file name injection - ([0190811](https://github.com/Abdulla-Aldosari/CommitMG/commit/0190811e074eed00b308fa0d6cdf6864a02a2a18))
- _(settings)_ Edit settings in the layer that defines them - ([ab11fbe](https://github.com/Abdulla-Aldosari/CommitMG/commit/ab11fbe0ba0cc36bbdcf61864fb316701a94f735))
- _(settings)_ Write preset changes in one ordered step - ([bcf8395](https://github.com/Abdulla-Aldosari/CommitMG/commit/bcf8395d62178fe4423fbdb42b949bf1ad2e5464))
- _(settings)_ Warn when a custom base URL is not encrypted - ([a01d069](https://github.com/Abdulla-Aldosari/CommitMG/commit/a01d0697632079c20a01880372ff0099dbd8367b))
- _(settings)_ Allow only https external links - ([21fea26](https://github.com/Abdulla-Aldosari/CommitMG/commit/21fea26d1e34deca9f9943b7607bf143c295dddd))

### ⚡ Performance

- _(generation)_ Skip evidence work when nothing changed - ([53677fa](https://github.com/Abdulla-Aldosari/CommitMG/commit/53677fa2e9e4726857a07ee5957c260266c8f4e0))

## [1.0.0] - 2026-10-09

- Initial release
