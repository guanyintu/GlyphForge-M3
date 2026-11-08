import { afterEach, expect, it, vi } from "vitest";
const { createClient }=vi.hoisted(()=>({createClient:vi.fn()}));
vi.mock("@supabase/supabase-js",()=>({createClient}));
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.resetModules();});
it("disabled cloud sharing never initializes the SDK or exchanges an OAuth callback even with public configuration",async()=>{
 vi.stubEnv("VITE_SUPABASE_URL","https://glyphforge-disabled.example.invalid");
 vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY","sb_publishable_mock_only");
 vi.stubGlobal("location",{origin:"https://glyphforge.example.invalid",href:"https://glyphforge.example.invalid/?code=disabled"});
 const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
 const { onlineSharingEnabled }=await import("../community/availability");
 expect(onlineSharingEnabled).toBe(false);
 const { cloud,oauthCallbackError }=await import("../community/client");
 expect(cloud.mode).toBe("unconfigured");
 expect(await cloud.user()).toBeNull();
 expect(await oauthCallbackError).toBe("");
 expect(createClient).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});
