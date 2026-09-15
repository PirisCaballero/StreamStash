# Política de privacidad

*Última actualización: 15 de septiembre de 2026*

## Resumen

**StreamStash no recoge, almacena en servidores, envía ni vende ningún dato personal.** Todo el procesamiento ocurre en tu navegador.

## 1. Responsable

Aitor Piris Caballero · aitor@aitorp.dev

## 2. Qué datos maneja la extensión y dónde se quedan

| Dato | Uso | Dónde se guarda | Cuánto dura |
|---|---|---|---|
| URLs de los vídeos detectados en la pestaña | Mostrarlos en el popup | Almacenamiento de sesión local del navegador (`storage.session`) | Se borran al navegar a otra página, al cerrar la pestaña o al cerrar el navegador |
| URL y título de la página del vídeo | Enviar la cabecera `Referer` a la web original y dar nombre al archivo | En memoria, solo durante la descarga | Se descartan al terminar la descarga |
| Los propios archivos de vídeo | Guardarlos en tu dispositivo | Tu carpeta de descargas | Hasta que tú los borres |

## 3. Qué NO hace

- No tiene servidores propios ni envía información al Autor ni a terceros.
- No incluye analítica, telemetría, publicidad ni rastreadores.
- No lee, guarda ni transmite tu historial de navegación, contraseñas, formularios ni cookies.
- No crea perfiles de usuario ni requiere cuenta.

## 4. Peticiones de red

Las únicas peticiones que realiza la extensión van **directamente a la web donde está el vídeo**, para descargar la playlist y los fragmentos. Esas peticiones pueden incluir las cookies y la cabecera `Referer` que tu navegador enviaría normalmente a esa web. Lo que haga esa web con sus peticiones se rige por su propia política de privacidad.

## 5. Permisos del navegador

- **Acceso a los sitios web y `webRequest`**: detectar archivos de vídeo en el tráfico de la pestaña. Solo se examinan las cabeceras de tipo y tamaño; no se leen ni se guardan contenidos de páginas ni datos personales.
- **`downloads`**: guardar los archivos.
- **`storage`**: lista temporal de vídeos por pestaña.
- **`tabs`**: identificar la pestaña activa y abrir la pestaña de progreso.
- **`declarativeNetRequestWithHostAccess`**: añadir la cabecera `Referer` a las peticiones de descarga, solo en la pestaña de progreso y solo mientras dura la descarga.

## 6. Datos que nos envías tú

Si escribes al correo de contacto o abres un *issue* en GitHub, se tratarán los datos que decidas facilitar (nombre, correo, texto del mensaje) solo para responderte. En GitHub se aplica además la política de privacidad de GitHub. Puedes pedir el acceso, la rectificación o la supresión de tus datos, y otros derechos del RGPD, escribiendo a aitor@aitorp.dev. También puedes reclamar ante la Agencia Española de Protección de Datos (aepd.es).

## 7. Uso limitado (Chrome Web Store)

El uso de la información obtenida a través de las API del navegador se ajusta a la política de datos de usuario de la Chrome Web Store, incluidos sus requisitos de uso limitado: los datos solo se usan para ofrecer la función única de la extensión, no se transfieren a terceros y no se usan para publicidad ni para evaluar solvencia.

## 8. Menores

La extensión no recoge datos de nadie, tampoco de menores.

## 9. Cambios

Cualquier cambio se publicará en este documento con una nueva fecha de actualización. Si alguna versión futura necesitara tratar datos de otra forma, se indicará claramente antes de aplicarse.
