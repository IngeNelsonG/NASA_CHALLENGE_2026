# Transparencia Científica, Estadística y Operativa — Ember Calendar (NASA Space Apps Challenge 2026)

Este documento describe con rigor técnico y matemático cómo opera la plataforma para garantizar **cero falsificación de datos**, **interpretación 100 % determinista**, **continuidad histórica MODIS + VIIRS**, **evaluación de anomalías y alertas tempranas CAP-1.2**, **complementariedad con GOES-16/18/19 ABI**, y **sostenibilidad en 2027–2028+**.

---

## 1. Fundamentos Radiativos y Termografía Satelital (Ley de Planck y Ley de Wien)

El monitoreo de incendios activos se sustenta en la física de radiación de cuerpo negro:

1. **Ley de Planck**:
   $$B(\lambda, T) = \frac{2hc^2}{\lambda^5} \cdot \frac{1}{\exp\left(\frac{hc}{\lambda k_B T}\right) - 1}$$
   donde $T$ es la temperatura absoluta en Kelvin ($\text{K}$), $\lambda$ la longitud de onda ($\mu\text{m}$), $h$ la constante de Planck, $c$ la velocidad de la luz y $k_B$ la constante de Boltzmann.

2. **Ley de Desplazamiento de Wien**:
   $$\lambda_{\max} = \frac{b}{T}, \quad b \approx 2897{,}77\,\mu\text{m}\cdot\text{K}$$
   - **Fondo terrestre ambiental** ($T \approx 300\,\text{K}$): emite su máximo alrededor de $\lambda_{\max} \approx 9{,}66\,\mu\text{m}$ (infrarrojo térmico, TIR).
   - **Quema de biomasa activa** ($T \approx 600\text{–}1200\,\text{K}$): el pico se desplaza al **infrarrojo medio (MIR)** entre **$2{,}4$ y $4{,}8\,\mu\text{m}$** ($T = 800\,\text{K} \Rightarrow \lambda_{\max} \approx 3{,}62\,\mu\text{m}$).
   - En la ventana atmosférica de **$3{,}74\text{–}3{,}96\,\mu\text{m}$**, la radiancia del fuego genera un contraste de $10\text{–}25\times$ respecto al fondo ambiental medido simultáneamente en TIR ($11{,}0\text{–}11{,}45\,\mu\text{m}$), permitiendo detectar frentes sub-píxel.

3. **Potencia Radiativa del Fuego (FRP)**:
   Calculada en megavatios ($\text{MW}$) a partir del exceso de radiancia espectral en MIR respecto al fondo cercano (método de Wooster et al., 2003):
   $$\text{FRP} = \frac{\sigma \cdot A_{\text{píxel}}}{a} \sum_{i \in \text{fuego}} (L_{\text{MIR}, i} - L_{\text{MIR, bg}})$$

---

## 2. Armonización Multi-Sensor MODIS + VIIRS (Calibración y Fusión)

Implementado en [`backend/src/brasa/harmonization/calibrate.py`](backend/src/brasa/harmonization/calibrate.py) y [`backend/src/brasa/api/ember_routes.py`](backend/src/brasa/api/ember_routes.py):

1. **Filtrado determinista homogéneo**: se conservan únicamente detecciones de fuego en vegetación (`type = 0` en archivo científico estándar) excluyendo fuentes industriales/teas estáticas (`static_sources.csv`) y bajas confianzas. Los meses sin cobertura satelital previa al lanzamiento quedan en **`null`** (no observados), y los meses observados con cero incendios permanecen en **`0`**.
2. **Exclusión de enero de 2012 del ajuste de traslape**: Suomi NPP VIIRS comenzó ciencia operativa el **20 de enero de 2012** (solo 12 días de operación). Incluir ese mes parcial sesgaría a la baja la razón $k = \text{VIIRS}/\text{MODIS}$. La calibración solo utiliza meses de traslape completo desde **`2012-02` en adelante** (`VIIRS_FULL_START_MONTH`).
3. **Encogimiento Empírico de Bayes ($24$ meses)**: para evitar razones inestables en departamentos pequeños con pocos meses activos en traslape ($n$), la razón estimada se contrae suavemente hacia la mediana regional previa ($k_{\text{prior}}$):
   $$w = \frac{n}{n + 24}, \qquad k_{\text{post}} = w \cdot k_{\text{obs}} + (1 - w) \cdot k_{\text{prior}}$$
4. **Fusión por Inversa de Varianza e Intervalo del 90 %**:
   $$\hat{E}_{\text{MODIS}} = M, \qquad \hat{E}_{\text{VIIRS}} = \frac{V}{k_{\text{post}}}$$
   $$\hat{H} = \frac{w_M \hat{E}_{\text{MODIS}} + w_V \hat{E}_{\text{VIIRS}}}{w_M + w_V}, \qquad w_i = \frac{1}{\text{Var}(\hat{E}_i)}, \qquad \text{IC}_{90\%} = \hat{H} \pm 1{,}645\sqrt{\frac{1}{w_M + w_V}}$$
   En enero de 2012 se aplica tratamiento explícito de transición combinando MODIS previo al 20 de enero (escalado) y VIIRS posterior al 20 de enero sin dividir el mes parcial como si fuera un mes de 31 días.

---

## 3. Metodología Estadística para Detección de Anomalías

Implementado en `_assign_log_z_scores`, `_detect_anomalies_from_cells` ([`ember_routes.py`](backend/src/brasa/api/ember_routes.py)) y [`detector.py`](backend/src/brasa/alerts/detector.py):

### A. Transformación Estabilizadora de Varianza y $z$-Score Estacional (Serie Temporal)
Los conteos de incendios siguen distribuciones altamente asimétricas a la derecha (heavy-tailed). Antes de estandarizar, se aplica:
$$Y(t) = \ln(1 + \hat{H}(t))$$
Para eliminar el sesgo estacional (no confundir febrero seco con una anomalía), cada periodo $t$ se compara **únicamente contra su propio estrato estacional histórico** $s$ (mes del año $1\dots 12$ o ventana móvil de $\pm 7$ días para resolución diaria):
$$z(t) = \frac{Y(t) - \mu_s}{\max(\sigma_s,\ 0{,}25)}$$
Con esto se agrupan episodios consecutivos (Run-Length Encoding) cuando $z \ge 1{,}5$ (exceso) o $z \le -1{,}8$ con $\hat{H} > 20$ (déficit significativo):
- **Moderate**: $1{,}5 \le |z| < 2{,}0$
- **Strong**: $2{,}0 \le |z| < 2{,}5$
- **Extreme**: $|z| \ge 2{,}5$

### B. Estadística Robusta No Paramétrica y Regla de Línea Base Cero (Motor de Alertas)
En [`detector.py`](backend/src/brasa/alerts/detector.py), el mes de referencia se evalúa respecto al historial del mismo calendario mensual ($m \in \{1\dots 12\}$) usando dos familias complementarias:
1. **Paramétrica log-normal**: $z$-score logarítmico estacional $z$.
2. **Robusta no paramétrica** (resistente a megaincendios extremos en el histórico):
   - Mediana climatológica $M_m$, cuartiles $Q_{25}$, $Q_{75}$, Rango Intercuartílico ($\text{IQR} = Q_{75} - Q_{25}$) y percentil 90 ($p_{90}$).
   - Desviación Absoluta Mediana escalada normalizada:
     $$\text{MAD}_{\text{scaled}} = 1{,}4826 \cdot \text{mediana}\big(|X_{m,y} - M_m|\big)$$
     $$z_{\text{robusto}} = \frac{X_{\text{actual}} - M_m}{\max\left(\text{MAD}_{\text{scaled}},\ \frac{\text{IQR}}{1{,}349},\ 1{,}0\right)}$$
   - **Razón de anomalía ($R$)** con manejo explícito de meses históricamente en cero ($M_m = 0$):
     $$R = \frac{X_{\text{actual}}}{\max(M_m,\ 1{,}0)}$$
     Si un mes normalmente húmedo tiene $M_m = 0$ y ocurre un brote térmico real, $R$ refleja directamente la magnitud del brote en lugar de anularse.

### C. Persistencia, Aceleración y Teleconexión ENSO/ONI
- **Persistencia ($P$)**: número de meses consecutivos recientes con actividad $\ge 3{,}0$ eq-MODIS y superando $1{,}25 \cdot M_m$ (o $z \ge 1{,}0$).
- **Trayectoria**: diferencia de $z$-score respecto al mes anterior ($\Delta z = z_t - z_{t-1}$): `ACCELERATING` ($\Delta z \ge +0{,}4$ con $z_t \ge 1{,}0$), `RECEDING` ($\Delta z \le -0{,}4$), `PERSISTENT` o `STABLE`.
- **Actividad Fuera de Temporada (`unseasonal`)**: activado cuando $M_m \le 0{,}25 \cdot \max_{j}(M_j)$, $z \ge 1{,}5$ y $\hat{H} \ge 5{,}0$.
- **Índice Niño Oceánico (ONI, NOAA CPC)**: clasifica en `EL_NINO` ($\text{ONI} \ge +0{,}5\,^\circ\text{C}$), `LA_NINA` ($\text{ONI} \le -0{,}5\,^\circ\text{C}$) o `NEUTRAL`.

---

## 4. Sistema de Alertas Tempranas CAP-1.2 y Red Institucional

El motor evalúa determinísticamente cuatro niveles de severidad (`CRITICAL`, `WARNING`, `WATCH`, `NORMAL`) combinando señal estadística, persistencia, contexto ENSO y datos Near-Real-Time (LANCE VIIRS de los últimos 7 días):

- **ALERTA ROJA (`CRITICAL`)**: $(z \ge 2{,}0 \lor R \ge 2{,}5 \lor \text{NRT} \ge 250\,\%)$ **y** $(P \ge 2 \lor \text{ACCELERATING} \lor \text{unseasonal} \lor \text{EL\_NINO} \lor z \ge 2{,}5)$, con volumen mínimo operativo ($\hat{H} \ge 10$ o brote NRT $\ge 8$ detecciones).
- **ALERTA NARANJA (`WARNING`)**: $\hat{H} \ge 5$ y $(z \ge 1{,}5 \lor R \ge 1{,}8 \lor P \ge 2 \lor \text{NRT} \ge 200\,\%)$.
- **VIGILANCIA (`WATCH`)**: $(\hat{H} \ge 3 \land (z \ge 1{,}0 \lor R \ge 1{,}35 \lor (\text{ACCELERATING} \land \text{EL\_NINO})))$ o brote NRT $\ge 200\,\%$.

### Enrutamiento a Autoridades (`authorities.py`) y Exploración en el Frontend
- **Colombia (33 departamentos completos)**: mapeo automático hacia la **UNGRD**, **IDEAM**, **DNBC**, el respectivo **CDGRD** departamental y la Corporación Autónoma Regional (**CAR / CORMACARENA / CORPOAMAZONIA / CDA / CORPORINOQUIA / CORANTIOQUIA / CRC / etc.**) competente en [`backend/src/brasa/alerts/authorities.py`](backend/src/brasa/alerts/authorities.py).
- **Cobertura Global y Detección de Ubicación**: [`GET /api/alerts/overview`](backend/src/brasa/api/ember_routes.py) evalúa países a nivel mundial y los 33 departamentos de Colombia. En la interfaz ([`Anomalies.tsx`](src/features/anomalies/Anomalies.tsx)), la aplicación identifica el país del visitante (y permite ubicación GPS exacta opcional) para mostrar inmediatamente si existen alertas en su territorio, además de un monitor interactivo por país y departamento.

---

## 5. Complementariedad con Satélites Geoestacionarios GOES-16 / GOES-18 / GOES-19 ABI

Al evaluar la integración con imágenes NOAA/NESDIS GOES (como el enlace de Disco Completo Banda 16):

| Sensor / Producto | Bandas clave | Resolución / Cadencia | Rol correcto frente a la física radiativa |
|---|---|---|---|
| **MODIS (Terra/Aqua)** | $3{,}96\,\mu\text{m}$ + $11{,}0\,\mu\text{m}$ | $1\,\text{km}$ · ~4 pasos/día | Ancla histórica de 26 años (2000–presente). |
| **VIIRS (S-NPP/NOAA-20/21)** | $3{,}74\,\mu\text{m}$ + $11{,}45\,\mu\text{m}$ | $375\,\text{m}$ · ~6 pasos/día | Alta sensibilidad espacial e ingesta LANCE NRT (2012–presente). |
| **GOES ABI Banda 7 + Banda 14** | **$3{,}90\,\mu\text{m}$** + **$11{,}2\,\mu\text{m}$** | $2\,\text{km}$ · **cada 10 min** | **Sí detecta incendios** por Ley de Wien en MIR; ideal para seguimiento continuo sub-horario (entre pasos polares) y disparos tempranos en NRT. **No debe mezclarse en el conteo mensual histórico** para no sesgar los 26 años previos. |
| **GOES ABI Banda 16 ($\text{CO}_2$)** | **$13{,}3\,\mu\text{m}$** | $2\,\text{km}$ · cada 10 min | Banda de absorción de $\text{CO}_2$ para **altura y temperatura de topes nubosos**. Por Ley de Wien ($13{,}3\,\mu\text{m} \leftrightarrow T \sim 218\,\text{K}$), **no mide fuego activo**, sino cobertura nubosa densa útil como máscara de calidad para diagnosticar ocultamiento atmosférico. |

---

## 6. Ciclo de Vida Autónomo (2026 → 2027, 2028+)

La arquitectura está diseñada para operar continuamente sin fechas fijas quemadas:
1. **Ventanas dinámicas**: tanto las consultas del calendario (`to=todayIso()`) como los endpoints del backend (`date.today()`) y el script [`download_firms_archive.py`](backend/scripts/download_firms_archive.py) (`--last current_year - 1`) avanzan automáticamente con el reloj UTC del sistema.
2. **Actualización NRT automática cada 3 horas**: [`RecentSource`](backend/src/brasa/ingestion/recent.py) descarga cada 3 horas los archivos públicos LANCE 7-day de **Suomi NPP, NOAA-20 y NOAA-21** y los inyecta tanto en el explorador espacial, como en los calendarios recientes (`_merge_nrt_viirs_counts`) y en las alertas CAP-1.2, sin alterar la integridad de los datos históricos archivados.
3. **Consolidación anual Science Quality (SP)**: al finalizar cada año calendario (2026, 2027, 2028…), [`download_firms_archive.py`](backend/scripts/download_firms_archive.py), [`extend_archive.py`](backend/scripts/extend_archive.py) y [`build_dataset.py`](backend/scripts/build_dataset.py) consolidan los archivos re-procesados estándar de la NASA (`MCD14ML` / `VNP14IMG`). **Único riesgo operacional externo**: eventuales cambios de URL o retiro futuro de MODIS (Terra/Aqua en órbita extendida); por ello la serie está diseñada para sostenerse sobre la constelación VIIRS JPSS (NOAA-20 y NOAA-21) manteniendo la calibración equivalente MODIS.
