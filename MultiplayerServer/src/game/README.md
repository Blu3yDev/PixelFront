# Game Backend Layout

This folder is organized so gameplay backend code is easier to navigate.

- `core/world.js`: world lifecycle and simulation orchestration.
- `systems/`: gameplay systems installed onto `World.prototype`.
- `systems/index.js`: central export for all installable systems.
- `data/earthData.js`: static Earth climate/mask data loader and parser.
- `config.js`: shared gameplay constants.
- `utils.js`: shared utility helpers.
