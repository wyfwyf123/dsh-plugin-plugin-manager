import Schema from '@deepseek-ai/schemastery';
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings';
export const name = 'plugin-manager';
export const Config = Schema.object({
    plugins: Schema.dict(Schema.boolean()).default({}),
});
/** 本插件拥有的 settings 命名空间。 */
const NS = settingsNamespace('plugin-manager');
export function apply(ctx, config) {
    // settings 与 loader 都是可选服务；缺任何一个时插件安静地什么都不做。
    ctx.inject(['settings', 'loader'], (sctx) => {
        const settings = sctx.settings;
        const loader = sctx.loader;
        const logger = ctx.logger;
        let disposed = false;
        let syncing = false;
        let pending = false;
        // 命名空间由本插件注册；组合 base 是 cordis.patch.yml 的 config，用户层
        // 来自 settings.yaml / 设置页。installSettingsSection 负责 attach/detach/
        // 变更时的 setSource + onChange 布线。
        let source = () => config;
        installSettingsSection(ctx, NS, Config, config, {
            setSource: (current) => { source = current; },
            onChange: () => { queueSync(); },
            exposeToWeb: true,
        });
        logger.info('plugin-manager: mounted (plugins=%s)', JSON.stringify(source().plugins ?? {}));
        logger.info('plugin-manager: loader entries: %s', [...loader.entries()].map(e => e.id).join(', '));
        /** 按 id 在 loader 树里找 entry。 */
        const findEntry = (id) => {
            for (const entry of loader.entries()) {
                if (entry.id === id || entry.id.endsWith(':' + id))
                    return entry;
            }
            return undefined;
        };
        /** 把配置里的启用状态应用到 loader（热插拔）。 */
        const sync = async () => {
            if (disposed)
                return;
            const cfg = source();
            logger.info('plugin-manager: sync start, plugins=%s', JSON.stringify(cfg.plugins ?? {}));
            for (const [id, enabled] of Object.entries(cfg.plugins ?? {})) {
                // 同时处理主插件和它的客户端设置页 ui-<id>（如果有）。
                const entryIds = [id, `ui-${id}`];
                for (const entryId of entryIds) {
                    const entry = findEntry(entryId);
                    if (!entry) {
                        if (entryId === id)
                            logger.warn('plugin-manager: plugin "%s" not found in loader', id);
                        continue;
                    }
                    const shouldDisable = !enabled;
                    logger.info('plugin-manager: entry %s found, disabled=%s, shouldDisable=%s', entry.id, entry.disabled, shouldDisable);
                    if (entry.disabled === shouldDisable)
                        continue;
                    try {
                        logger.info('plugin-manager: calling update on %s with disabled=%s', entry.id, shouldDisable);
                        await entry.update({ disabled: shouldDisable });
                        logger.info('plugin-manager: %s plugin "%s" -> disabled=%s', shouldDisable ? 'disabled' : 'enabled', entryId, entry.disabled);
                    }
                    catch (error) {
                        logger.warn('plugin-manager: failed to %s plugin "%s"', shouldDisable ? 'disable' : 'enable', entryId);
                        logger.warn(error);
                    }
                }
            }
        };
        /** 串行化同步：一次只跑一个，期间的变更合并为一次后续同步。 */
        const queueSync = () => {
            if (disposed)
                return;
            if (syncing) {
                pending = true;
                return;
            }
            syncing = true;
            void (async () => {
                try {
                    await sync();
                }
                catch (error) {
                    logger.warn('plugin-manager: sync failed');
                    logger.warn(error);
                }
                finally {
                    syncing = false;
                    if (pending && !disposed) {
                        pending = false;
                        queueSync();
                    }
                }
            })();
        };
        // 配置变化或 loader 树变化时重新同步。
        // 配置变化或 loader 树变化时重新同步。
        sctx.on('settings/updated', (ns) => { if (ns === 'plugin-manager')
            queueSync(); });
        sctx.on('loader/config-update', () => queueSync());
        // 启动时应用一次，带重试等待 loader 就绪（否则配置里的插件 entry 还没挂载）。
        const RETRY_LIMIT = 60;
        let readyTimer;
        const tryReady = (attempt) => {
            if (disposed)
                return;
            const cfg = source();
            const ids = Object.keys(cfg.plugins ?? {});
            const allFound = ids.every(id => findEntry(id) !== undefined);
            // 有配置且 entry 就绪 -> 同步
            if (ids.length > 0 && allFound) {
                logger.info('plugin-manager: tryReady found all entries (attempt %d)', attempt);
                queueSync();
                return;
            }
            // 有配置但 entry 还没挂载 -> 继续重试
            if (ids.length > 0) {
                logger.info('plugin-manager: tryReady waiting for entries (attempt %d, ids=%s)', attempt, JSON.stringify(ids));
                if (attempt >= RETRY_LIMIT)
                    return;
                readyTimer = setTimeout(() => tryReady(attempt + 1), 500);
                return;
            }
            // 配置为空：可能是用户没配置，也可能是 settings 还没就绪。
            // 最多等 5 秒（10 次）再放弃，避免启动时漏掉用户层配置。
            if (attempt >= 10) {
                logger.info('plugin-manager: tryReady giving up (empty config, attempt %d)', attempt);
                return;
            }
            readyTimer = setTimeout(() => tryReady(attempt + 1), 500);
        };
        tryReady(0);
        sctx.effect(() => () => {
            disposed = true;
            if (readyTimer !== undefined)
                clearTimeout(readyTimer);
        }, 'plugin-manager: dispose');
    });
}
