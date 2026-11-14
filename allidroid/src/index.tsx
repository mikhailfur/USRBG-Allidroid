/*
 * USRBG for Allidroid
 * Copyright (c) 2026 mikhailfur and contributors
 * Based on the USRBG plugin for Vencord by AutumnVN, katlyn, pylix and TheKodeToad
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

declare const vendetta: any;

const { patcher, metro, ui, plugin } = vendetta;

const React = metro.common.React;
const RN = metro.common.ReactNative;
const logger = vendetta.logger ?? console;

const { findByName, findByProps, findByStoreName } = metro;

const API_URL = "https://usrbg.is-hardly.online/users";
const GET_YOUR_BANNER_URL = "https://github.com/AutumnVN/usrbg#how-to-request-your-own-usrbg-banner";
const REFRESH_MS = 6 * 60 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
const DISPLAY_PROFILE_PATH = "modules/user_profile/DisplayProfile.tsx";
const AVATAR_UTILS_PATH = "utils/AvatarUtils.tsx";
const DIRECT_BANNER_URL = "https://usrbg.is-hardly.online/usrbg/v2";

const DEFAULT_SETTINGS = {
    nitroFirst: false
};

type SettingKey = keyof typeof DEFAULT_SETTINGS;

interface UsrbgData {
    endpoint: string;
    bucket: string;
    prefix: string;
    users: Record<string, string>;
}

interface LoadState {
    loading: boolean;
    count: number;
    updatedAt: number;
    error: string | null;
}

const loadState: LoadState = {
    loading: false,
    count: 0,
    updatedAt: 0,
    error: null
};

let data: UsrbgData | null = null;
let lastLoadedAt = 0;
let lastAttemptAt = 0;
let loadPromise: Promise<boolean> | null = null;
let directBanners: Record<string, string> = {};
let directChecked = new Set<string>();

let active = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let patchAttempts = 0;
let helpersPatched = false;
let profilePatched = false;
let consumersPatched = false;
let unpatches: (() => void)[] = [];
const profileOverrides = new WeakMap<object, any>();
let patchedTargets = new WeakMap<object, Set<string>>();
let patchedFunctions = new WeakSet<Function>();

const statusListeners = new Set<() => void>();

const tableRowGroupModule = safeFindByProps("TableRowGroup");
const tableSwitchRowModule = safeFindByProps("TableSwitchRow");
const tableRowModule = safeFindByProps("TableRow");
const TableRowGroup = tableRowGroupModule?.TableRowGroup;
const TableSwitchRow = tableSwitchRowModule?.TableSwitchRow;
const TableRow = tableRowModule?.TableRow;

function safeFindByProps(...props: string[]): any {
    try {
        return findByProps(...props);
    } catch {
        return null;
    }
}

function safeFindByName(name: string, defaultExport = true): any {
    try {
        return findByName(name, defaultExport);
    } catch {
        return null;
    }
}

function store(name: string): any {
    try {
        return findByStoreName(name);
    } catch {
        return null;
    }
}

function getSetting(key: SettingKey): boolean {
    const value = plugin.storage?.[key];
    return value === undefined ? DEFAULT_SETTINGS[key] : Boolean(value);
}

function setSetting(key: SettingKey, value: boolean) {
    plugin.storage[key] = value;
    redrawProfiles();
}

function icon(name: string): number | undefined {
    try {
        return ui.assets.getAssetIDByName(name);
    } catch {
        return undefined;
    }
}

function toast(text: string, asset?: number) {
    try {
        ui.toasts.showToast(text, asset);
    } catch (error) {
        logger.warn("[USRBG] Не удалось показать уведомление", error);
    }
}

function openURL(url: string) {
    try {
        const linking = RN?.Linking ?? metro.common.url;
        void linking.openURL(url);
    } catch (error) {
        logger.warn("[USRBG] Не удалось открыть ссылку", error);
    }
}

function notifyStatus() {
    for (const listener of statusListeners) {
        try {
            listener();
        } catch (error) {
            logger.warn("[USRBG] Ошибка в обработчике состояния", error);
        }
    }
}

function parseData(raw: any): UsrbgData | null {
    if (!raw || typeof raw !== "object" || !raw.users || typeof raw.users !== "object") return null;
    if (typeof raw.endpoint !== "string" || !raw.endpoint.startsWith("https://")) return null;

    return {
        endpoint: raw.endpoint.replace(/\/+$/, ""),
        bucket: typeof raw.bucket === "string" ? raw.bucket : "",
        prefix: typeof raw.prefix === "string" ? raw.prefix : "",
        users: raw.users
    };
}

function bannerBaseURL(source: UsrbgData, userId: string): string {
    const path = [source.bucket, source.prefix]
        .filter(Boolean)
        .join("/")
        .replace(/\/+/g, "/")
        .replace(/^\/+|\/+$/g, "");

    return `${source.endpoint}/${path ? `${path}/` : ""}${userId}`;
}

function imageURL(source: UsrbgData, userId: string, etag: string): string {
    return `${bannerBaseURL(source, userId)}?${encodeURIComponent(etag)}`;
}

function currentUserId(): string | null {
    try {
        const id = store("UserStore")?.getCurrentUser?.()?.id;
        return id == null ? null : String(id);
    } catch {
        return null;
    }
}

async function checkDirectBanner(userId: string) {
    if (directChecked.has(userId)) return;

    directChecked.add(userId);
    const url = data ? bannerBaseURL(data, userId) : `${DIRECT_BANNER_URL}/${userId}`;

    try {
        const response = await fetch(url, { method: "HEAD" });
        if (!response.ok) return;

        directBanners[userId] = url;
        logger.info(`[USRBG] Прямая ссылка на баннер ${userId} работает`);
        redrawProfiles();
        notifyStatus();
    } catch (error) {
        logger.warn(`[USRBG] Не удалось проверить прямой баннер ${userId}`, error);
    }
}

function getImageURL(userId?: string | null): string | null {
    if (!userId || !active) return null;

    if (!data) {
        if (Date.now() - lastAttemptAt > RETRY_MS) void loadData();

        if (userId === currentUserId()) {
            if (!directChecked.has(userId)) void checkDirectBanner(userId);
            return directBanners[userId] ?? null;
        }

        return null;
    }

    if (Date.now() - lastLoadedAt > REFRESH_MS) void loadData();

    const etag = data.users[userId];
    if (typeof etag === "string" && etag) return imageURL(data, userId, etag);

    // The public list can lag behind a newly approved banner. Check the
    // canonical image URL for the current account before giving up.
    if (userId === currentUserId()) {
        if (!directChecked.has(userId)) void checkDirectBanner(userId);
        return directBanners[userId] ?? null;
    }

    return null;
}

async function loadData(force = false): Promise<boolean> {
    if (loadPromise) return loadPromise;
    if (!force && data && Date.now() - lastLoadedAt < REFRESH_MS) return true;
    if (!force && Date.now() - lastAttemptAt < RETRY_MS) return Boolean(data);

    lastAttemptAt = Date.now();
    loadState.loading = true;
    loadState.error = null;
    notifyStatus();

    loadPromise = (async () => {
        let timer: ReturnType<typeof setTimeout> | null = null;

        try {
            const controller = new AbortController();
            timer = setTimeout(() => controller.abort(), 30_000);

            const response = await fetch(API_URL, {
                cache: "no-cache",
                signal: controller.signal
            });

            if (!response.ok) throw new Error(`USRBG ответил ${response.status}`);

            const parsed = parseData(await response.json());
            if (!parsed) throw new Error("USRBG вернул неожиданный ответ");
            if (!active) return false;

            data = parsed;
            lastLoadedAt = Date.now();
            loadState.count = Object.keys(parsed.users).length;
            loadState.updatedAt = lastLoadedAt;
            loadState.error = null;

            logger.info(`[USRBG] Загружено ${loadState.count} баннеров`);
            redrawProfiles();
            return true;
        } catch (error: any) {
            loadState.error = String(error?.message ?? error);
            logger.error("[USRBG] Не удалось загрузить список баннеров", error);
            return false;
        } finally {
            if (timer) clearTimeout(timer);
            loadState.loading = false;
            loadPromise = null;
            notifyStatus();
        }
    })();

    return loadPromise;
}

function redrawProfiles() {
    for (const name of ["UserStore", "UserProfileStore"]) {
        try {
            store(name)?.emitChange?.();
        } catch (error) {
            logger.warn(`[USRBG] Не удалось обновить ${name}`, error);
        }
    }
}

function userIdOf(value: any): string | null {
    if (!value) return null;
    if (typeof value === "string") return value;

    const id = value.id ?? value.userId ?? value.user_id ?? value.user?.id ?? value._userProfile?.userId;
    return id == null ? null : String(id);
}

function hasBanner(value: any): boolean {
    if (!value || typeof value !== "object") return false;

    return Boolean(
        value.banner
        ?? value.user?.banner
        ?? value.displayProfile?.banner
        ?? value._guildMemberProfile?.banner
        ?? value._userProfile?.banner
    );
}

function patchAfter(name: string, parent: any, callback: (...args: any[]) => any): boolean {
    const original = parent?.[name];
    if (typeof original !== "function" || patchedFunctions.has(original)) return false;

    let keys = patchedTargets.get(parent);
    if (!keys) patchedTargets.set(parent, keys = new Set());
    if (keys.has(name)) return false;

    try {
        const unpatch = patcher.after(name, parent, callback);
        if (typeof unpatch !== "function") return false;

        keys.add(name);
        patchedFunctions.add(original);
        unpatches.push(unpatch);
        return true;
    } catch (error) {
        logger.warn(`[USRBG] Не удалось запатчить ${name}`, error);
        return false;
    }
}

function patchBefore(name: string, parent: any, callback: (...args: any[]) => any): boolean {
    const original = parent?.[name];
    if (typeof original !== "function" || patchedFunctions.has(original)) return false;

    let keys = patchedTargets.get(parent);
    if (!keys) patchedTargets.set(parent, keys = new Set());
    if (keys.has(name)) return false;

    try {
        const unpatch = patcher.before(name, parent, callback);
        if (typeof unpatch !== "function") return false;

        keys.add(name);
        patchedFunctions.add(original);
        unpatches.push(unpatch);
        return true;
    } catch (error) {
        logger.warn(`[USRBG] Не удалось запатчить ${name}`, error);
        return false;
    }
}

function moduleAtPath(path: string): any[] {
    const modules = (metro as any).modules;
    if (!modules) return [];

    const found: any[] = [];

    for (const id in modules) {
        if (modules[id]?.__filePath !== path) continue;

        let exports = modules[id]?.publicModule?.exports ?? modules[id]?.exports;

        try {
            if (!exports || (typeof exports === "object" && Reflect.ownKeys(exports).length === 0)) {
                exports = (globalThis as any).__r?.(Number(id)) ?? exports;
            }
        } catch {
            // The module is initialized by the next attempt.
        }

        if (exports) found.push(exports);
    }

    return found;
}

function modulesWith(prop: string): any[] {
    const found = new Set<any>();
    const related = prop === "getUserBannerURL"
        ? ["getUserAvatarURL", "getGuildMemberBannerURL", "getUserAvatarSource"]
        : ["getUserAvatarURL", "getUserBannerURL"];

    const add = (mod: any, requireRelated: boolean) => {
        if (!mod) return;
        if (typeof mod[prop] !== "function") return;
        if (requireRelated && !related.some(key => typeof mod[key] === "function")) return;
        found.add(mod);
    };

    for (const exports of moduleAtPath(AVATAR_UTILS_PATH)) {
        add(exports, false);
        add(exports?.default, false);
    }

    const modules = (metro as any).modules;
    if (modules) {
        for (const id in modules) {
            const exports = modules[id]?.publicModule?.exports ?? modules[id]?.exports;

            try {
                add(exports, true);
                add(exports?.default, true);
            } catch (error) {
                logger.warn(`[USRBG] Не удалось прочитать модуль ${id}`, error);
            }
        }
    }

    try {
        add(safeFindByProps(prop, "getUserAvatarURL"), false);
        add(safeFindByProps(prop, "getGuildMemberBannerURL"), false);
        add(safeFindByProps("default", prop), false);
        add(safeFindByProps(prop), false);
    } catch (error) {
        logger.warn(`[USRBG] Не удалось найти модули с ${prop}`, error);
    }

    return [...found];
}

function patchBannerHelpers(): boolean {
    let patched = false;

    for (const mod of modulesWith("getUserBannerURL")) {
        patched = patchAfter("getUserBannerURL", mod, ([value]: any[], result: any) => {
            const url = getImageURL(userIdOf(value));
            if (!url) return result;
            if (getSetting("nitroFirst") && hasBanner(value)) return result;
            return url;
        }) || patched;
    }

    for (const mod of modulesWith("getGuildMemberBannerURL")) {
        patched = patchAfter("getGuildMemberBannerURL", mod, ([value]: any[], result: any) => {
            const url = getImageURL(userIdOf(value));
            if (!url) return result;
            if (getSetting("nitroFirst") && hasBanner(value)) return result;
            return url;
        }) || patched;
    }

    return patched;
}

function isDisplayProfileClass(value: any): boolean {
    return typeof value === "function"
        && typeof value.prototype?.getBannerURL === "function"
        && (
            typeof value.prototype?.getPreviewBanner === "function"
            || typeof value.prototype?.isUsingGuildMemberBanner === "function"
            || typeof value.prototype?.getPreviewBio === "function"
        );
}

function asClass(value: any): any {
    if (isDisplayProfileClass(value)) return value;
    if (isDisplayProfileClass(value?.default)) return value.default;
    if (isDisplayProfileClass(value?.default?.default)) return value.default.default;
    return null;
}

function classFromExports(value: any): any {
    const hasBannerURL = (candidate: any) =>
        typeof candidate === "function"
        && typeof candidate.prototype?.getBannerURL === "function";

    if (hasBannerURL(value)) return value;
    if (hasBannerURL(value?.default)) return value.default;
    if (hasBannerURL(value?.default?.default)) return value.default.default;
    return null;
}

function findDisplayProfileClasses(): any[] {
    const found = new Set<any>();

    for (const exports of moduleAtPath(DISPLAY_PROFILE_PATH)) {
        const profile = classFromExports(exports);
        if (profile) found.add(profile);
    }

    const modules = (metro as any).modules;

    if (modules) {
        for (const id in modules) {
            const exports = modules[id]?.publicModule?.exports ?? modules[id]?.exports;

            try {
                const profile = asClass(exports) ?? asClass(exports?.default) ?? asClass(exports?.DisplayProfile);
                if (profile) found.add(profile);
            } catch (error) {
                logger.warn(`[USRBG] Не удалось прочитать модуль ${id}`, error);
            }
        }
    }

    for (const value of [
        safeFindByName("DisplayProfile", false),
        safeFindByName("DisplayProfile", true)
    ]) {
        const profile = asClass(value);
        if (profile) found.add(profile);
    }

    try {
        const profile = asClass(metro.find((mod: any) =>
            isDisplayProfileClass(mod) || isDisplayProfileClass(mod?.default)
        ));
        if (profile) found.add(profile);
    } catch (error) {
        logger.warn("[USRBG] Не удалось найти DisplayProfile через metro.find", error);
    }

    return [...found];
}

function patchDisplayProfile(): boolean {
    let patched = false;

    for (const DisplayProfile of findDisplayProfileClasses()) {
        patched = patchAfter("getBannerURL", DisplayProfile.prototype, function (this: any, _args: any[], result: any) {
            const url = getImageURL(this?.userId);
            if (!url) return result;
            if (getSetting("nitroFirst") && hasBanner(this)) return result;
            return url;
        }) || patched;
    }

    return patched;
}

function withBannerOverride(profile: any): any {
    if (!profile || typeof profile !== "object" || !profile.userId) return profile;

    const cached = profileOverrides.get(profile);
    if (cached) return cached;

    const url = getImageURL(String(profile.userId));
    if (!url || (getSetting("nitroFirst") && hasBanner(profile))) return profile;

    try {
        const original = typeof profile.getBannerURL === "function" ? profile.getBannerURL.bind(profile) : null;
        const clone = Object.create(Object.getPrototypeOf(profile));
        Object.defineProperties(clone, Object.getOwnPropertyDescriptors(profile));

        Object.defineProperty(clone, "getBannerURL", {
            configurable: true,
            value: function (options: any) {
                const url = getImageURL(String(profile.userId));
                if (!url) return original?.(options);
                if (getSetting("nitroFirst") && hasBanner(profile)) return original?.(options);
                return url;
            }
        });

        profileOverrides.set(profile, clone);
        return clone;
    } catch (error) {
        logger.warn("[USRBG] Не удалось подменить DisplayProfile", error);
        return profile;
    }
}

function patchProfileConsumers(): boolean {
    let patched = false;

    const hookModule = moduleAtPath("modules/user_profile/hooks/useDisplayProfile.tsx")[0]
        ?? safeFindByName("useDisplayProfile", false)
        ?? safeFindByName("useDisplayProfile", true);

    if (hookModule) {
        for (const key of ["default", "getDisplayProfile", "useDisplayProfileWithFetchEffect"]) {
            if (typeof hookModule[key] === "function") {
                patched = patchAfter(key, hookModule, (_args: any[], result: any) => withBannerOverride(result)) || patched;
            }
        }
    }

    const bannerModule = moduleAtPath("modules/user_profile/native/UserProfileBanner.tsx")[0]
        ?? safeFindByName("UserProfileBanner", false)
        ?? safeFindByName("UserProfileBanner", true);

    const decorateProps = ([props]: any[]) => {
        if (!props?.displayProfile) return;

        const decorated = withBannerOverride(props.displayProfile);
        if (decorated === props.displayProfile) return;

        return [{ ...props, displayProfile: decorated }];
    };

    if (bannerModule) {
        const component = bannerModule.default;

        if (typeof component === "function") {
            patched = patchBefore("default", bannerModule, decorateProps) || patched;
        } else if (typeof component?.type === "function") {
            patched = patchBefore("type", component, decorateProps) || patched;
        } else if (typeof component?.type?.render === "function") {
            patched = patchBefore("render", component.type, decorateProps) || patched;
        } else if (typeof component?.render === "function") {
            patched = patchBefore("render", component, decorateProps) || patched;
        }
    }

    return patched;
}

function tryPatch() {
    if (!active) return;

    if (!helpersPatched) helpersPatched = patchBannerHelpers();
    if (!profilePatched) profilePatched = patchDisplayProfile();
    if (!consumersPatched) consumersPatched = patchProfileConsumers();

    if (helpersPatched && profilePatched) {
        if (!consumersPatched) consumersPatched = patchProfileConsumers();
        logger.info("[USRBG] Патчи баннеров активны");
        return;
    }

    if (++patchAttempts >= 30) {
        logger.warn("[USRBG] Не все функции баннеров Discord найдены, плагин продолжит работать без них");
        return;
    }

    retryTimer = setTimeout(tryPatch, 1000);
}

function onLoad() {
    active = true;
    patchAttempts = 0;
    helpersPatched = false;
    profilePatched = false;
    consumersPatched = false;
    unpatches = [];
    patchedTargets = new WeakMap();
    patchedFunctions = new WeakSet();

    tryPatch();

    const ownId = currentUserId();
    if (ownId) void checkDirectBanner(ownId);
    void loadData(!data);
}

function onUnload() {
    active = false;

    if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
    }

    for (const unpatch of unpatches) {
        try {
            unpatch();
        } catch (error) {
            logger.warn("[USRBG] Не удалось снять патч", error);
        }
    }

    unpatches = [];
    helpersPatched = false;
    profilePatched = false;
    consumersPatched = false;
    loadPromise = null;
}

function useStatus() {
    const [, forceUpdate] = React.useState(0);

    React.useEffect(() => {
        const listener = () => forceUpdate((value: number) => value + 1);
        statusListeners.add(listener);
        return () => {
            statusListeners.delete(listener);
        };
    }, []);

    return loadState;
}

function SettingSwitch({ setting, label, subLabel }: { setting: SettingKey; label: string; subLabel: string; }) {
    const [value, setValue] = React.useState(() => getSetting(setting));

    return (
        <TableSwitchRow
            label={label}
            subLabel={subLabel}
            value={value}
            onValueChange={(next: boolean) => {
                setSetting(setting, next);
                setValue(next);
            }}
        />
    );
}

function RefreshRow() {
    const status = useStatus();

    const trailing = status.loading
        ? "Загрузка…"
        : status.error
            ? "Ошибка"
            : status.count
                ? `${status.count}`
                : "Нет данных";

    return (
        <TableRow
            label="Обновить список баннеров"
            subLabel={status.error ? "Последняя загрузка не удалась" : "Скачать свежий список с сервера USRBG"}
            disabled={status.loading}
            trailing={TableRow.TrailingText ? <TableRow.TrailingText text={trailing} /> : trailing}
            onPress={async () => {
                const ok = await loadData(true);
                if (!active) return;

                toast(
                    ok ? `USRBG: загружено ${loadState.count} баннеров` : "USRBG: не удалось загрузить список",
                    icon(ok ? "CheckmarkSmallIcon" : "WarningIcon")
                );
            }}
        />
    );
}

function hasNitroBanner(userId: string): boolean {
    try {
        return Boolean(store("UserProfileStore")?.getUserProfile?.(userId)?.banner);
    } catch {
        return false;
    }
}

function CheckBannerRow() {
    const status = useStatus();
    const id = currentUserId();
    const url = id ? getImageURL(id) : null;
    const nitro = id ? hasNitroBanner(id) : false;

    const trailing = !id
        ? "Нет ID"
        : status.loading && !status.count
            ? "Загрузка…"
            : url
                ? "Найден"
                : status.count
                    ? "Нет в базе"
                    : "Нет данных";

    return (
        <TableRow
            label="Проверить мой баннер"
            subLabel={id ? `ID: ${id} · Nitro: ${nitro ? "да" : "нет"}` : "Не удалось получить ID"}
            trailing={TableRow.TrailingText ? <TableRow.TrailingText text={trailing} /> : trailing}
            onPress={() => {
                const current = currentUserId();
                if (!current) {
                    toast("USRBG: не удалось получить ваш ID", icon("WarningIcon"));
                    return;
                }

                const banner = getImageURL(current);
                if (!banner) {
                    toast(
                        loadState.count
                            ? `USRBG: ID ${current} нет в базе`
                            : loadState.loading
                                ? "USRBG: список ещё загружается"
                                : "USRBG: список не загружен",
                        icon("WarningIcon")
                    );
                    logger.info(`[USRBG] ${current} отсутствует в списке баннеров`);
                    return;
                }

                if (getSetting("nitroFirst") && hasNitroBanner(current)) {
                    toast("USRBG найден. Выключи «Сначала баннер Nitro».", icon("WarningIcon"));
                } else {
                    toast("USRBG: баннер найден, открываю", icon("CheckmarkSmallIcon"));
                }

                openURL(banner);
            }}
        />
    );
}

function StatusRow() {
    const status = useStatus();
    const patches = `${profilePatched ? "профиль" : "профиль нет"} · ${helpersPatched ? "баннеры" : "баннеры нет"} · ${consumersPatched ? "хуки" : "хуки нет"}`;

    return (
        <TableRow
            label="Состояние"
            subLabel={status.error ?? "Патчи и загруженная база"}
            disabled
            trailing={TableRow.TrailingText ? <TableRow.TrailingText text={patches} /> : patches}
        />
    );
}

function Settings() {
    if (!TableRowGroup || !TableSwitchRow || !TableRow) {
        return (
            <RN.ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24 }}>
                <RN.Text>Не удалось найти компоненты настроек Allidroid.</RN.Text>
            </RN.ScrollView>
        );
    }

    return (
        <RN.ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingVertical: 24, paddingHorizontal: 12 }}
        >
            <TableRowGroup title="USRBG">
                <SettingSwitch
                    setting="nitroFirst"
                    label="Сначала баннер Nitro"
                    subLabel="Если у пользователя есть баннер Nitro, показывать его вместо USRBG"
                />
                <RefreshRow />
                <TableRow
                    label="Получить свой баннер"
                    subLabel="Как добавить себя в базу USRBG"
                    arrow
                    onPress={() => openURL(GET_YOUR_BANNER_URL)}
                />
            </TableRowGroup>
            <TableRowGroup title="Диагностика">
                <CheckBannerRow />
                <StatusRow />
            </TableRowGroup>
        </RN.ScrollView>
    );
}

export default {
    onLoad,
    onUnload,
    settings: Settings
};
