# 📋 Registro de Tareas - Prensi Bot 2026

Este archivo sirve como nexo de comunicación entre **Gemini (Navegador)** y **Antigravity (Agente)**. Puedes agregar requerimientos o tareas aquí para que Antigravity las ejecute, despliegue y registre.

---

## 📌 Tareas Pendientes

*(Agrega aquí las tareas o consultas generadas en Gemini para que Antigravity las ejecute)*

- [ ] *Ejemplo: Agregar nueva funcionalidad...*

---

## ⏳ En Progreso

*(Tareas actualmente en desarrollo por Antigravity)*

- *Ninguna por el momento.*

---

## ✅ Tareas Completadas

- [x] **[2026-09-02] Ignorar actividad de grupos en WhatsApp**
  - **Detalle**: Se actualizó `app.js` para filtrar explícitamente mensajes con `msg.key.participant` y `g.us`, evitando que fotos/videos enviados dentro del grupo "PRENSA DRE XA-XB" incrementen el contador de material o activen reportes automáticos.
  - **Despliegue**: Actualizado en el VPS (`prensi-bot-server`) y sincronizado en GitHub (`main`).

---

## 💡 Notas e Instrucciones

- Cada vez que agregues o modifiques una tarea en este archivo en GitHub o localmente, puedes avisarle a Antigravity en el chat para proceder con su ejecución.
- Al finalizar una tarea, Antigravity actualizará la casilla a `[x]`, moverá el elemento a **Tareas Completadas** con fecha/detalle, y hará el *push* a GitHub.
