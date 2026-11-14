# USRBG-Allidroid

Порт плагина [USRBG](https://github.com/Vendicated/Vencord/tree/main/src/plugins/usrbg) для мобильного клиента [Allidroid](https://github.com/FlibatsUniverse/Allidroid).

Плагин показывает баннеры из базы USRBG у пользователей без Nitro. Ставится как user plugin по ссылке, без пересборки Allidroid.

| Клиент | Платформа | Папка |
| --- | --- | --- |
| Allidroid | Android / iOS | [`allidroid/`](allidroid/) |

## Установка

Рекомендуемая ссылка с автообновлением из ветки `main`:

```
https://raw.githubusercontent.com/mikhailfur/USRBG-Allidroid/main/allidroid/
```

В приложении: **Plugins → Add a user plugin** → вставить ссылку → включить **USRBG**.

Allidroid сам добавляет к этой ссылке `manifest.json` и `index.js`, поэтому raw-ссылка на папку работает. При следующем запуске приложения плагин проверит `manifest.json`, сравнит `hash` и скачает новый `index.js`, если он изменился. Raw GitHub кэширует файлы примерно на 5 минут, так что свежий коммит подхватится без пересборки Allidroid.

Другие варианты:

- **CDN с автообновлением:** `https://cdn.jsdelivr.net/gh/mikhailfur/USRBG-Allidroid@main/allidroid/` — jsDelivr может отдавать кэш дольше, чем raw GitHub.
- **Стабильная версия без автообновления:** `https://cdn.jsdelivr.net/gh/mikhailfur/USRBG-Allidroid@v1.0.1/allidroid/`.

Подробности, настройки и ограничения — в [README плагина](allidroid/README.md).

## Как это работает

Плагин загружает список баннеров с `https://usrbg.is-hardly.online/users` и патчит рендер баннеров в профилях Discord:

- `DisplayProfile.prototype.getBannerURL`
- `AvatarUtils.getUserBannerURL`
- `AvatarUtils.getGuildMemberBannerURL`

Если у пользователя нет Nitro-баннера, возвращается ссылка на USRBG. Настройка **Сначала баннер Nitro** решает, что показывать, когда есть оба баннера.

## Лицензия

GPL-3.0-or-later. Оригинальный USRBG для Vencord написали AutumnVN, katlyn, pylix и TheKodeToad.
