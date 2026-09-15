<p align="center">
  <img src="icons/icon-128.png" width="96" alt="StreamStash">
</p>

<h1 align="center">StreamStash</h1>

<p align="center">
  Extensión para Chrome y Firefox que detecta los vídeos de una página y los descarga,<br>
  incluidos los streams HLS, que se convierten a un MP4 normal sin perder calidad.
</p>

---

## ¿Qué hace?

Abres una web con un vídeo, pulsas el icono de StreamStash y aparece la lista de vídeos detectados con un botón **Descargar**. Nada más.

Por debajo pasan más cosas:

- **Detección doble.** Revisa las etiquetas `<video>` de la página y además escucha el tráfico de red, así que encuentra también los vídeos que el reproductor carga por su cuenta.
- **Descarga de streams HLS (`.m3u8`).** Lee la playlist, elige la mejor calidad disponible y baja los fragmentos en paralelo, con reintentos.
- **Conversión a MP4 estándar.** Los fragmentos MP4 se reorganizan en un único archivo MP4 convencional. No se recodifica nada: la calidad es idéntica al original, fotograma a fotograma, y el archivo se abre en cualquier reproductor, incluido QuickTime.
- **Popup sin ruido.** Oculta segmentos de inicialización, fragmentos sueltos y sub-playlists duplicadas.
- **Todo en local.** No hay servidores, cuentas, analítica ni telemetría. Ver [Privacidad](#privacidad).

## Lo que NO hace, a propósito

| Caso | Comportamiento |
|---|---|
| Contenido con DRM o cifrado (Netflix, Prime Video, Disney+…) | Se detiene y lo indica. **Nunca se añadirá soporte para eludir protecciones.** |
| Emisiones en directo | No compatibles; solo vídeos completos. |
| Streams DASH (`.mpd`) | Todavía no compatibles. |
| Vídeos `blob:` sin playlist visible en la red | No se pueden detectar. |

## Instalación

StreamStash todavía no está publicada en las tiendas. Para probarla, carga la versión de desarrollo:

**Chrome, Edge o Brave**
1. Descarga o clona este repositorio.
2. Abre `chrome://extensions` y activa el **Modo de desarrollador**.
3. Pulsa **Cargar descomprimida** y selecciona la carpeta del proyecto.

**Firefox (121 o superior)**
1. Ejecuta `./build.sh`.
2. Abre `about:debugging#/runtime/this-firefox`.
3. Pulsa **Cargar complemento temporal** y elige `dist/firefox/manifest.json`.

La guía completa, con uso y solución de problemas, está en **[docs/GUIA-DE-USO.md](docs/GUIA-DE-USO.md)**.

## Compilar

```bash
./build.sh
```

Genera `dist/chrome.zip` y `dist/firefox.zip`. Chrome usa `manifest.json` (service worker) y Firefox usa `manifest.firefox.json` (background scripts).

## Estructura

```
├── manifest.json            # Manifest V3 para Chrome
├── manifest.firefox.json    # Manifest V3 para Firefox
├── background.js            # Detección por red y almacenamiento por pestaña
├── content.js               # Detección en el DOM
├── popup.html / popup.js    # Lista de vídeos
├── download.html / .js      # Descarga HLS y conversión fMP4 → MP4
├── icons/
├── docs/                    # Guía de uso
└── legal/                   # Aviso legal, términos y privacidad
```

## Permisos

| Permiso | Para qué se usa |
|---|---|
| `webRequest` + acceso a todos los sitios | Detectar vídeos en el tráfico de red de la pestaña. |
| `downloads` | Guardar los archivos en tu carpeta de descargas. |
| `storage` | Guardar la lista de vídeos de cada pestaña durante la sesión. Se borra al navegar o cerrar la pestaña. |
| `tabs` | Saber qué pestaña está activa y abrir la pestaña de progreso. |
| `declarativeNetRequestWithHostAccess` | Enviar la cabecera `Referer` de la página original al descargar fragmentos, ya que muchos servidores la exigen. |

## Privacidad

StreamStash **no recoge, envía ni vende datos**. Todo se procesa en tu navegador y las únicas peticiones que hace van a la web donde está el vídeo. Política completa: [legal/POLITICA-DE-PRIVACIDAD.md](legal/POLITICA-DE-PRIVACIDAD.md).

## ⚠️ Uso responsable

StreamStash es una herramienta técnica pensada para guardar **contenido propio, con licencia libre o que tienes permiso para descargar**, y para la copia privada en los términos que permite la ley.

**Tú eres responsable de lo que descargas y de lo que haces con ello.** Respeta los derechos de autor y las condiciones de uso de cada web. No uses StreamStash para distribuir contenido ajeno ni para eludir medidas de protección.

Antes de usarla, lee el [Aviso legal](legal/AVISO-LEGAL.md) y los [Términos de uso](legal/TERMINOS-DE-USO.md).

## Hoja de ruta

- [ ] Selector de calidad antes de descargar
- [ ] Unir vídeo y audio cuando la web los sirve por separado
- [ ] Conversión de fragmentos `.ts` a MP4
- [ ] Soporte para DASH sin cifrar
- [ ] Publicación en Chrome Web Store y Firefox Add-ons

## Contribuir

Los pull requests son bienvenidos. Lee antes [CONTRIBUTING.md](CONTRIBUTING.md): hay cosas que no se van a aceptar nunca.

## Licencia

[MIT](LICENSE) © 2026 Aitor Piris Caballero · [aitorp.dev](https://aitorp.dev)
