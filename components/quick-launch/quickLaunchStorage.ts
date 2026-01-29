import { Storage } from "@plasmohq/storage"

export { TOP_SITES_ID, RECENT_ID, GROUPS_KEY } from "@neutab/shared/constants/quickLaunchStorage"

export const syncStorage = new Storage()
export const localExtStorage = new Storage({ area: "local" })
export const localImageExtStorage = new Storage({ area: "local" })
