-- client/radio.lua — Crew radio (pma-voice)
-- Server sends our crew's channel; we join it in pma-voice. Talking to the crew
-- uses pma-voice's own radio talk key. /crewradio toggles it on/off.

local radioOn = true
local channel = 0

local function apply()
    if GetResourceState("pma-voice") ~= "started" then return end
    -- pma-voice's join export is setRadioChannel (setPlayerRadio does NOT exist —
    -- calling it silently failed inside pcall, so the radio never connected).
    if radioOn and channel > 0 then
        pcall(function() exports["pma-voice"]:setRadioChannel(channel) end)
    else
        pcall(function() exports["pma-voice"]:setRadioChannel(0) end)
    end
end

RegisterNetEvent("spz-crew:radio", function(ch)
    channel = tonumber(ch) or 0
    apply()
    if channel > 0 then
        lib.notify({ description = "Crew radio connected — hold the radio key to talk", type = "success", duration = 4000 })
    end
end)

-- Ask the server for our channel once things have loaded.
CreateThread(function()
    Wait(3000)
    TriggerServerEvent("spz-crew:reqRadio")
end)

RegisterCommand("crewradio", function()
    if channel == 0 then
        lib.notify({ description = "You're not in a crew", type = "error" })
        return
    end
    radioOn = not radioOn
    apply()
    lib.notify({ description = "Crew radio: " .. (radioOn and "ON" or "OFF"), type = radioOn and "success" or "inform" })
end, false)

RegisterKeyMapping("crewradio", "Toggle crew radio", "keyboard", "")

AddEventHandler("onResourceStop", function(res)
    if res == GetCurrentResourceName() and GetResourceState("pma-voice") == "started" then
        pcall(function() exports["pma-voice"]:removePlayerFromRadio() end)
    end
end)
