fx_version 'cerulean'
game 'gta5'

name 'spz-crew'
description 'SPiceZ Crew — dashboard to create/browse/join crews, manage the roster, kick, disband. Reuses spz-identity crew backend.'
version '1.0.0'
author 'SPiceZ-Core'
lua54 'yes'

shared_scripts {
  '@ox_lib/init.lua',
}

client_scripts {
  'client/main.lua',
  'client/radio.lua',
}

server_scripts {
  '@oxmysql/lib/MySQL.lua',
  'server/main.lua',
  'server/radio.lua',
}

ui_page 'ui/index.html'

files {
  'ui/index.html',
  'ui/style.css',
  'ui/app.js',
  'ui/fonts/*.ttf',
}

dependencies {
  'ox_lib',
  'oxmysql',
  'spz-core',
  'spz-identity',
  'pma-voice',
}
