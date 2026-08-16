window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-client-ui-plugin-manager",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/plugin-manager-controller.ts
		/**
		* The plugin-manager settings page's live form over the `plugin-manager`
		* settings namespace. Every toggle writes through the settings scope
		* immediately, so the host plugin-manager applies the change at runtime
		* (hot reload, no restart).
		*/
		/** Namespace of the plugin-manager capability; the scratch host plugin spells the same value. */
		const PLUGIN_MANAGER_NS = "plugin-manager";
		/** Bridges the `plugin-manager` scope onto the page's live form. */
		var PluginManagerController = class {
			scope;
			addText = "";
			saving = false;
			failed = false;
			expandedId = null;
			listeners = /* @__PURE__ */ new Set();
			constructor(scope) {
				this.scope = scope;
				scope.subscribe(() => this.publish());
			}
			value() {
				return this.scope.getSnapshot().value ?? {};
			}
			projection() {
				const snap = this.scope.getSnapshot();
				const plugins = Object.entries(this.value().plugins ?? {}).map(([id, enabled]) => ({
					id,
					enabled
				})).sort((a, b) => a.id.localeCompare(b.id));
				return {
					available: snap.status === "ready",
					writable: snap.writable,
					plugins,
					addText: this.addText,
					saving: this.saving,
					failed: this.failed,
					expandedId: this.expandedId
				};
			}
			/** Build the face the page's slot registration injects. */
			inject() {
				const store = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)(this.projection());
				this.listeners.add(() => {
					store.set(this.projection());
				});
				return {
					hooks: { pluginManagerSection: store },
					editAddText: (text) => {
						this.addText = text;
						this.publish();
					},
					toggle: (id, enabled) => {
						this.toggle(id, enabled);
					},
					add: () => {
						this.add();
					},
					toggleExpand: (id) => {
						this.expandedId = this.expandedId === id ? null : id;
						this.publish();
					}
				};
			}
			async toggle(id, enabled) {
				if (this.saving) return;
				this.saving = true;
				this.failed = false;
				this.publish();
				try {
					const plugins = { ...this.value().plugins ?? {} };
					plugins[id] = enabled;
					await this.scope.set("plugins", plugins);
				} catch {
					this.failed = true;
				} finally {
					this.saving = false;
					this.publish();
				}
			}
			async add() {
				const id = this.addText.trim();
				if (id.length === 0 || this.saving) return;
				this.saving = true;
				this.failed = false;
				this.publish();
				try {
					const plugins = { ...this.value().plugins ?? {} };
					if (!(id in plugins)) plugins[id] = true;
					await this.scope.set("plugins", plugins);
					this.addText = "";
				} catch {
					this.failed = true;
				} finally {
					this.saving = false;
					this.publish();
				}
			}
			publish() {
				for (const listener of this.listeners) listener();
			}
		};
		//#endregion
		//#region \0dsh-css:D:\ai\deepseekharness\packages\client\ui-plugin-manager\src\client\PluginManagerSection.module.css.mjs
		const css = ".Z9PxtG_section{max-width:720px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}.Z9PxtG_title{margin:0;font-size:18px;font-weight:600}.Z9PxtG_intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px}.Z9PxtG_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px}.Z9PxtG_readOnly{color:var(--dsw-alias-warning-fg,#b26a00);margin:0;font-size:13px}.Z9PxtG_empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px}.Z9PxtG_list{flex-direction:column;gap:8px;margin:0;padding:0;list-style:none;display:flex}.Z9PxtG_item{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-surface-l2);border-radius:10px;flex-direction:column;display:flex;overflow:hidden}.Z9PxtG_row{align-items:center;gap:10px;padding:10px 12px;display:flex}.Z9PxtG_idButton{cursor:pointer;font:inherit;color:inherit;text-align:left;background:0 0;border:none;flex:1;align-items:center;gap:6px;min-width:0;padding:0;display:flex}.Z9PxtG_id{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:13px;overflow:hidden}.Z9PxtG_chevron{color:var(--dsw-alias-label-tertiary);flex:none;font-size:11px}.Z9PxtG_tag{border:1px solid;border-radius:999px;flex:none;padding:2px 10px;font-size:12px}.Z9PxtG_tag[data-on=true]{color:var(--dsw-alias-success-fg,#0a7d33);border-color:var(--dsw-alias-success-fg,#0a7d33);background:var(--dsw-alias-success-bg,#0a7d3314)}.Z9PxtG_tag[data-on=false]{color:var(--dsw-alias-label-tertiary);border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-surface-l2)}.Z9PxtG_toggle{font:inherit;cursor:pointer;border:1px solid;border-radius:8px;flex:none;padding:6px 14px;font-size:12px}.Z9PxtG_toggle[data-on=true]{color:var(--dsw-alias-danger-fg,#c22);border-color:var(--dsw-alias-danger-fg,#c22);background:0 0}.Z9PxtG_toggle[data-on=false]{color:#fff;border-color:var(--dsw-alias-accent,#0a7d33);background:var(--dsw-alias-accent,#0a7d33)}.Z9PxtG_toggle:disabled{opacity:.5;cursor:default}.Z9PxtG_detail{border-top:1px solid var(--dsw-alias-border-l2);padding:14px 12px}.Z9PxtG_fallback{color:var(--dsw-alias-label-tertiary);flex-direction:column;gap:4px;font-size:13px;display:flex}.Z9PxtG_fallback p{margin:0}.Z9PxtG_fallbackHint{opacity:.8;font-size:12px}.Z9PxtG_addRow{align-items:center;gap:8px;margin-top:4px;display:flex}.Z9PxtG_addLabel{flex:none;font-size:13px;font-weight:600}.Z9PxtG_addInput{border:1px solid var(--dsw-alias-border-l2);min-width:0;font:inherit;background:var(--dsw-alias-surface-l2);color:inherit;border-radius:8px;flex:1;padding:7px 10px;font-size:13px}.Z9PxtG_addInput:focus{outline:2px solid var(--dsw-alias-accent,#4d6bfe);outline-offset:1px}.Z9PxtG_addInput:disabled{opacity:.55}.Z9PxtG_addButton{border:1px solid var(--dsw-alias-accent,#4d6bfe);background:var(--dsw-alias-accent,#4d6bfe);color:#fff;font:inherit;cursor:pointer;border-radius:8px;flex:none;padding:7px 16px;font-size:13px}.Z9PxtG_addButton:disabled{opacity:.5;cursor:default}.Z9PxtG_failed{color:var(--dsw-alias-danger-fg,#c22);margin:0;font-size:13px}";
		const tagId = "@deepseek-ai/dsh-client-ui-plugin-manager/PluginManagerSection.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-plugin-manager";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var PluginManagerSection_module_css_default = {
			"chevron": "Z9PxtG_chevron",
			"failed": "Z9PxtG_failed",
			"toggle": "Z9PxtG_toggle",
			"empty": "Z9PxtG_empty",
			"section": "Z9PxtG_section",
			"fallbackHint": "Z9PxtG_fallbackHint",
			"detail": "Z9PxtG_detail",
			"list": "Z9PxtG_list",
			"row": "Z9PxtG_row",
			"item": "Z9PxtG_item",
			"addLabel": "Z9PxtG_addLabel",
			"fallback": "Z9PxtG_fallback",
			"intro": "Z9PxtG_intro",
			"id": "Z9PxtG_id",
			"addRow": "Z9PxtG_addRow",
			"addInput": "Z9PxtG_addInput",
			"hint": "Z9PxtG_hint",
			"tag": "Z9PxtG_tag",
			"readOnly": "Z9PxtG_readOnly",
			"title": "Z9PxtG_title",
			"idButton": "Z9PxtG_idButton",
			"addButton": "Z9PxtG_addButton"
		};
		//#endregion
		//#region src/client/PluginManagerSection.tsx
		/** Fallback shown when a plugin has no registered detail panel. */
		function PluginDetailFallback(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: PluginManagerSection_module_css_default.fallback,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: props.t("noDetail") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: PluginManagerSection_module_css_default.fallbackHint,
					children: props.t("noDetailHint")
				})]
			});
		}
		/**
		* Render the plugin-manager settings page.
		* @param props - locale copy, the page snapshot, its form actions, and slot renderer.
		* @returns the page, or nothing when the namespace is unavailable.
		*/
		function PluginManagerSection(props) {
			const { t } = props;
			const state = props.usePluginManagerSection((snapshot) => snapshot);
			if (!state.available) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: PluginManagerSection_module_css_default.section,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						className: PluginManagerSection_module_css_default.title,
						children: t("nav")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: PluginManagerSection_module_css_default.intro,
						children: t("description")
					}),
					!state.writable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: PluginManagerSection_module_css_default.readOnly,
						role: "status",
						children: t("readOnly")
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: PluginManagerSection_module_css_default.hint,
						children: t("hint")
					}),
					state.plugins.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: PluginManagerSection_module_css_default.empty,
						children: t("empty")
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: PluginManagerSection_module_css_default.list,
						children: state.plugins.map((plugin) => {
							const expanded = state.expandedId === plugin.id;
							const owner = {
								pluginId: plugin.id,
								enabled: plugin.enabled,
								writable: state.writable,
								saving: state.saving
							};
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
								className: PluginManagerSection_module_css_default.item,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: PluginManagerSection_module_css_default.row,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: PluginManagerSection_module_css_default.idButton,
											title: plugin.id,
											onClick: () => {
												props.toggleExpand(plugin.id);
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
												className: PluginManagerSection_module_css_default.id,
												children: plugin.id
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: PluginManagerSection_module_css_default.chevron,
												"data-open": expanded ? "true" : void 0,
												children: expanded ? "▾" : "▸"
											})]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: PluginManagerSection_module_css_default.tag,
											"data-on": plugin.enabled ? "true" : "false",
											children: plugin.enabled ? t("enabledTag") : t("disabledTag")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: PluginManagerSection_module_css_default.toggle,
											"data-on": plugin.enabled ? "true" : "false",
											disabled: !state.writable || state.saving,
											onClick: () => {
												props.toggle(plugin.id, !plugin.enabled);
											},
											children: plugin.enabled ? t("disable") : t("enable")
										})
									]
								}), expanded ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: PluginManagerSection_module_css_default.detail,
									children: props.renderSlot("plugin-manager.detail", owner, {
										entryKey: plugin.id,
										fallback: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PluginDetailFallback, {
											pluginId: plugin.id,
											enabled: plugin.enabled,
											t: (k) => t(k)
										})
									})
								}) : null]
							}, plugin.id);
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PluginManagerSection_module_css_default.addRow,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
								className: PluginManagerSection_module_css_default.addLabel,
								htmlFor: "plugin-manager-add",
								children: t("addLabel")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								id: "plugin-manager-add",
								className: PluginManagerSection_module_css_default.addInput,
								type: "text",
								value: state.addText,
								placeholder: t("addPlaceholder"),
								disabled: !state.writable || state.saving,
								onChange: (event) => {
									props.editAddText(event.currentTarget.value);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: PluginManagerSection_module_css_default.addButton,
								disabled: !state.writable || state.saving || state.addText.trim().length === 0,
								onClick: props.add,
								children: t("add")
							})
						]
					}),
					state.failed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: PluginManagerSection_module_css_default.failed,
						role: "status",
						children: t("notFound", { id: "" })
					}) : null
				]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/** `pluginManager` namespace dictionaries. */
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"nav": "插件管理",
			"description": "管理后续开发的插件：一键启用/关闭，运行时生效，无需重启；点击插件可展开其设置",
			"readOnly": "当前设置不可写（只读或内存模式）。",
			"empty": "还没有可管理的插件。在下方输入插件 id 添加。",
			"addLabel": "添加插件",
			"addPlaceholder": "插件 id，如 deepseek-thinking",
			"add": "添加",
			"enabledTag": "已启用",
			"disabledTag": "已停用",
			"enable": "启用",
			"disable": "关闭",
			"noDetail": "该插件没有独立设置面板",
			"noDetailHint": "插件只提供启停控制。若要提供设置面板，请注册 plugin-manager.detail slot（key = 插件 id）。",
			"notFound": "插件 {id} 未在 loader 中找到（可能未注册或 id 写错）",
			"hint": "点击插件行展开设置；「启用/关闭」立即生效，无需重启。"
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"nav": "Plugin Manager",
			"description": "Manage user-developed plugins: one-click enable/disable, live, no restart; click a plugin to open its settings",
			"readOnly": "Settings are read-only right now.",
			"empty": "No managed plugins yet. Add a plugin id below.",
			"addLabel": "Add plugin",
			"addPlaceholder": "Plugin id, e.g. deepseek-thinking",
			"add": "Add",
			"enabledTag": "Enabled",
			"disabledTag": "Disabled",
			"enable": "Enable",
			"disable": "Disable",
			"noDetail": "This plugin has no dedicated settings panel",
			"noDetailHint": "The plugin only provides enable/disable. To add a settings panel, register the plugin-manager.detail slot (key = plugin id).",
			"notFound": "Plugin {id} not found in loader (not registered or wrong id)",
			"hint": "Click a plugin row to expand settings; Enable/Disable applies immediately, no restart."
		};
		//#endregion
		//#region src/client/index.ts
		/** Dictionary namespace owned by this plugin. */
		const NS = "pluginManager";
		/** Required services: the slot ledger, the locale seat, and the settings-scope binder. */
		const inject = [
			"slots",
			"locale",
			"settingsScope"
		];
		/** Contribute the plugin-manager page to the Settings sidebar navigation. */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-plugin-manager: page dictionaries");
			const controller = new PluginManagerController(ctx.settingsScope.bind({ namespace: PLUGIN_MANAGER_NS }));
			const t = ctx.locale.bind(NS);
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "plugin-manager",
				order: 40,
				label: () => t("nav"),
				locale: NS,
				children: { "plugin-manager.detail": {
					kind: "keyed",
					scope: "root"
				} },
				inject: () => controller.inject()
			}, PluginManagerSection));
		}
		//#endregion
		exports.NS = NS;
		exports.PluginManagerController = PluginManagerController;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map