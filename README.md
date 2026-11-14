# USRBG-Allidroid

Порт плагина [USRBG](https://github.com/Vendicated/Vencord/tree/main/src/plugins/usrbg) для мобильного клиента [Allidroid](https://github.com/FlibatsUniverse/Allidroid).

Плагин показывает баннеры из базы USRBG у пользователей без Nitro. Ставится как user plugin по ссылке, без пересборки Allidroid.

| Клиент | Платформа | Папка |
| --- | --- | --- |
| Allidroid | Android / iOS | [`allidroid/`](allidroid/) |

## Установка

Ссылка для Allidroid:

```
https://cdn.jsdelivr.net/gh/mikhailfur/USRBG-Allidroid@v1.0.0/allidroid/
```

В приложении: **Plugins → Add a user plugin** → вставить ссылку → включить **USRBG**.

Подробности, настройки и ограничения — в [README плагина](allidroid/README.md).

## Как это работает

Плагин загружает список баннеров с `https://usrbg.is-hardly.online/users` и патчит рендер баннеров в профилях Discord:

- `DisplayProfile.prototype.getBannerURL`
- `AvatarUtils.getUserBannerURL`
- `AvatarUtils.getGuildMemberBannerURL`

Если у пользователя нет Nitro-баннера, возвращается ссылка на USRBG. Настройка **Сначала баннер Nitro** решает, что показывать, когда есть оба баннера.

## Лицензия

GPL-3.0-or-later. Оригинальный USRBG для Vencord написали AutumnVN, katlyn, pylix и TheKodeToad.
