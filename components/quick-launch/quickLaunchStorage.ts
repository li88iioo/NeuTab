import { Storage } from "@plasmohq/storage"

export const TOP_SITES_ID = "__top_sites__"
export const RECENT_ID = "__recent__"
export const GROUPS_KEY = "quickLaunchGroups"

export const syncStorage = new Storage()
export const localExtStorage = new Storage({ area: "local" })
export const localImageExtStorage = new Storage({ area: "local" })
