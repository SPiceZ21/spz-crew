-- client/main.lua — Crew dashboard
-- /crew opens the dashboard NUI. NUI callbacks proxy straight to the server
-- callbacks; the UI renders my crew + roster and lets me create / browse / join
-- / leave (owner: kick / disband).

local open = false

RegisterNetEvent("spz-crew:notify", function(msg, t)
    lib.notify({ description = msg, type = t or "info" })
end)

local function pushData()
    local data = lib.callback.await("spz-crew:data", false) or {}
    local list = lib.callback.await("spz-crew:list", false) or {}
    SendNUIMessage({ action = "data", data = data, list = list })
end

local function openDash()
    if open then return end
    open = true
    SetNuiFocus(true, true)
    SendNUIMessage({ action = "show" })
    pushData()
end

local function closeDash()
    open = false
    SetNuiFocus(false, false)
    SendNUIMessage({ action = "hide" })
end

RegisterCommand("crew", function() if open then closeDash() else openDash() end end, false)
RegisterKeyMapping("crew", "Open crew dashboard", "keyboard", "")

-- ── NUI callbacks ─────────────────────────────────────────────────────────────

RegisterNUICallback("close", function(_, cb) closeDash(); cb(1) end)

RegisterNUICallback("refresh", function(_, cb)
    pushData(); cb(1)
end)

RegisterNUICallback("create", function(d, cb)
    local res = lib.callback.await("spz-crew:create", false, d.name, d.tag)
    if res and res.ok then lib.notify({ description = "Crew created", type = "success" }) pushData()
    else lib.notify({ description = (res and res.error) or "Failed", type = "error" }) end
    cb(res or { ok = false })
end)

RegisterNUICallback("join", function(d, cb)
    local res = lib.callback.await("spz-crew:join", false, d.crewId)
    if res and res.ok then lib.notify({ description = "Joined crew", type = "success" }) pushData()
    else lib.notify({ description = (res and res.error) or "Failed", type = "error" }) end
    cb(res or { ok = false })
end)

RegisterNUICallback("leave", function(_, cb)
    local res = lib.callback.await("spz-crew:leave", false)
    if res and res.ok then lib.notify({ description = "Left crew", type = "info" }) pushData()
    else lib.notify({ description = (res and res.error) or "Failed", type = "error" }) end
    cb(res or { ok = false })
end)

RegisterNUICallback("kick", function(d, cb)
    local res = lib.callback.await("spz-crew:kick", false, d.pid)
    if res and res.ok then lib.notify({ description = "Member removed", type = "info" }) pushData()
    else lib.notify({ description = (res and res.error) or "Failed", type = "error" }) end
    cb(res or { ok = false })
end)

RegisterNUICallback("disband", function(_, cb)
    local res = lib.callback.await("spz-crew:disband", false)
    if res and res.ok then lib.notify({ description = "Crew disbanded", type = "warning" }) pushData()
    else lib.notify({ description = (res and res.error) or "Failed", type = "error" }) end
    cb(res or { ok = false })
end)

-- ESC closes.
CreateThread(function()
    while true do
        if open then
            if IsControlJustPressed(0, 177) or IsControlJustPressed(0, 202) then closeDash() end
            Wait(0)
        else
            Wait(300)
        end
    end
end)

AddEventHandler("onResourceStop", function(res)
    if res == GetCurrentResourceName() and open then SetNuiFocus(false, false) end
end)
