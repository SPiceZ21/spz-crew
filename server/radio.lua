-- server/radio.lua — Crew radio channel assignment
-- Puts every crew member on a shared pma-voice radio channel (900000 + crew_id,
-- a dedicated range so it can't clash with any job radios). The client joins the
-- channel via pma-voice; talking uses pma-voice's own radio key.

local RADIO_BASE = 900000

local function crewIdOf(src)
    local ok, p = pcall(function() return exports["spz-identity"]:GetProfile(src) end)
    return ok and p and p.crew_id or nil
end

local function pushRadio(src)
    local cid = crewIdOf(src)
    TriggerClientEvent("spz-crew:radio", src, cid and (RADIO_BASE + cid) or 0)
end

-- Crew changes (create/join/leave/kick/disband all fire this) → refresh radio.
AddEventHandler("SPZ:crewChanged", function(src)
    pushRadio(src)
end)

-- Set on spawn/ready and on client request.
AddEventHandler("SPZ:playerReady", function(src)
    pushRadio(src)
end)

RegisterNetEvent("spz-crew:reqRadio", function()
    pushRadio(source)
end)
