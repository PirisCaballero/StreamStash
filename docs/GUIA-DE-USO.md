# Guía de uso de StreamStash

## 1. Instalación

### Chrome, Edge y Brave

1. Descarga el proyecto y descomprímelo si viene en `.zip`.
2. Escribe `chrome://extensions` en la barra de direcciones (en Edge, `edge://extensions`).
   > Tienes que escribirlo a mano: Chrome bloquea los enlaces `chrome://` pulsados desde otra web.
3. Activa **Modo de desarrollador** (arriba a la derecha; en Edge, en la barra lateral).
4. Pulsa **Cargar descomprimida** y selecciona la carpeta que contiene `manifest.json`.
5. Fija la extensión: icono del puzzle 🧩 → chincheta junto a StreamStash.

### Firefox

1. En la carpeta del proyecto, ejecuta `./build.sh`.
2. Abre `about:debugging#/runtime/this-firefox`.
3. Pulsa **Cargar complemento temporal…** y elige `dist/firefox/manifest.json`.

> En Firefox, las extensiones temporales se eliminan al cerrar el navegador. Para instalarla de forma permanente hay que firmarla en addons.mozilla.org.

### Actualizar a una versión nueva

Sustituye los archivos de la carpeta y pulsa el icono de recargar ⟳ en la tarjeta de la extensión. Después recarga las webs que tuvieras abiertas.

## 2. Cómo se usa

1. **Abre la página del vídeo y dale al play unos segundos.** Muchos reproductores no piden el vídeo hasta que empieza a reproducirse, así que sin ese paso a veces no hay nada que detectar.
2. **Pulsa el icono de StreamStash.** El número sobre el icono indica cuántos vídeos ha encontrado.
3. **Pulsa Descargar** en el vídeo que quieras:
   - **Archivo directo** (`.mp4`, `.webm`…): se descarga al momento, como cualquier descarga del navegador.
   - **Stream HLS**: se abre una pestaña con el progreso. **No la cierres** hasta que ponga *Descarga completada*.
4. El archivo aparece en tu carpeta de descargas con el título de la página como nombre.

### Qué significa cada entrada del popup

| Texto | Significado |
|---|---|
| *Stream HLS · se descargará la mejor calidad* | Es la playlist principal. Suele ser la opción buena. |
| *Stream HLS* | Una playlist de una calidad concreta. |
| *X MB · detectado en red* | Archivo de vídeo directo visto en el tráfico de red. |
| *detectado en página* | URL sacada de una etiqueta `<video>`. A veces no es el archivo real. |
| *Stream DASH · todavía no compatible* | Formato `.mpd`, aún no soportado. |

## 3. Recomendaciones

- **Si hay varias entradas, empieza por la que dice "mejor calidad".**
- **Descarga de una en una.** Los streams se montan en memoria; varias descargas grandes a la vez pueden ralentizar mucho el navegador.
- **Con vídeos muy largos** (más de 2 GB aproximadamente), cierra pestañas pesadas antes de empezar.
- **Si la descarga falla a mitad, recarga la página del vídeo y vuelve a intentarlo.** Muchos enlaces llevan un token que caduca.
- **Archivos `.ts`**: se abren con VLC o IINA, no con QuickTime.
- **Mantén la extensión actualizada.** Las webs cambian y las correcciones llegan con las versiones nuevas.
- **Descarga solo lo que tengas derecho a descargar.** Ver el [Aviso legal](../legal/AVISO-LEGAL.md).

## 4. Solución de problemas

| Problema | Qué hacer |
|---|---|
| No aparece ningún vídeo | Reproduce el vídeo unos segundos y vuelve a abrir el popup. Si el vídeo usa `blob:` sin playlist visible, no se puede detectar. |
| *La web ha denegado el acceso (403)* | Recarga la página del vídeo, dale al play y vuelve a descargar. El enlace probablemente había caducado. |
| *Este vídeo está cifrado o protegido* | Tiene DRM o cifrado. StreamStash no lo descarga y no lo hará. |
| *Parece una emisión en directo* | Solo se pueden descargar vídeos completos. |
| Se guardan dos archivos, vídeo y audio | La web sirve el audio por separado. Unirlos está en la hoja de ruta. |
| La duración aparece mal en el reproductor | Abre **Detalles técnicos** al final de la descarga y adjunta esos datos en un *issue*. |
| Errores en `chrome://extensions` | Recarga la extensión, borra los errores antiguos con la papelera y comprueba si vuelven a aparecer. |

## 5. Informar de un fallo

Abre un *issue* en GitHub con:
- Navegador y versión.
- Qué esperabas y qué ha pasado.
- El texto de **Detalles técnicos**, si lo hay.
- Errores de `chrome://extensions` o de la consola.

**No incluyas enlaces a contenido protegido ni a webs piratas.** Esos *issues* se cerrarán.
