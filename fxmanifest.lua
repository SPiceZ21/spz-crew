fx_version 'cerulean'
game 'gta5'

name 'spz-crew'
description 'SPiceZ Crew — dashboard to create/browse/join crews, manage the roster, kick, disband. Reuses spz-identity crew backend.'
version '1.2.2'
author 'SPiceZ-Core'
lua54 'yes'

shared_scripts {
  '@ox_lib/init.lua',
}

client_scripts {
    '@spz-hud/shim.lua',   -- NUI goes through spz-hud
  'client/main.lua',
  'client/radio.lua',
}

server_scripts {
  '@oxmysql/lib/MySQL.lua',
  'server/main.lua',
  'server/rival.lua',
  'server/radio.lua',
}

-- ui_page 'ui/index.html'  -- drawn by spz-hud now (web/public/apps/spz-crew); uncomment + drop the shim to roll back

-- UI files are not shipped from here: spz-hud serves this resource's page
-- (synced from ui/ by spz-hud/tools/sync-apps.mjs).

dependencies {
    'spz-hud',
  'ox_lib',
  'oxmysql',
  'spz-core',
  'spz-identity',
  'pma-voice',
}
