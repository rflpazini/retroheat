import { BootScreen as Splash } from '@/components/retro-os/boot-screen'

/** RetroHeat's startup screen; the chrome is the registry's boot-screen item. */
export function BootScreen() {
  return (
    <Splash
      name="RetroHeat"
      tagline="Retro game price momentum"
      status="Loading catalog"
      storageKey="retroheat-booted"
    />
  )
}
