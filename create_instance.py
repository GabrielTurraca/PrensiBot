import oci
import time
import sys
import os
import urllib.request
import urllib.parse
import json
import random

def load_dotenv_fallback():
    for env_path in [".env", "/home/ubuntu/prensi-bot/.env", os.path.join(os.path.dirname(__file__), ".env")]:
        if os.path.exists(env_path):
            try:
                with open(env_path, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith("#") or "=" not in line:
                            continue
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip("'").strip('"')
                        if k and k not in os.environ:
                            os.environ[k] = v
            except Exception:
                pass

load_dotenv_fallback()

# Configuration paths & environment overrides
CONFIG_PATH = os.environ.get("OCI_CONFIG_PATH", "/home/ubuntu/.oci/config")
LOG_PATH = os.environ.get("OCI_LOG_PATH", "/home/ubuntu/oci-create-instance/creation.log")
INSTANCE_NAME = os.environ.get("OCI_INSTANCE_NAME", "prensi-bot-server-ARM")
COMPARTMENT_ID = os.environ.get(
    "OCI_COMPARTMENT_ID",
    "ocid1.compartment.oc1..aaaaaaaapjx74fkkbt756ep7irp6c3evmotu4sfw7lze5aoif3xi24umpxmq"
)
AVAILABILITY_DOMAIN = os.environ.get("OCI_AVAILABILITY_DOMAIN", "oLnV:SA-SANTIAGO-1-AD-1")
IMAGE_ID = os.environ.get(
    "OCI_IMAGE_ID",
    "ocid1.image.oc1.sa-santiago-1.aaaaaaaai5ja32pjngtc7qay4zz4cuhusti5wggho3nkkttm2j22z6dx7lya"
)
SUBNET_ID = os.environ.get(
    "OCI_SUBNET_ID",
    "ocid1.subnet.oc1.sa-santiago-1.aaaaaaaadlrln3apqfe5g3srft2eogt5dlstclwv4jo42dmcbs424itvgdja"
)
SSH_AUTHORIZED_KEYS = os.environ.get(
    "OCI_SSH_AUTHORIZED_KEYS",
    "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDOsq2yGNd+ZjDQq8FPsWK+AVmJeXc0RCKzNPoN8a3kAmmpi/r7cR+V6tczZBV96CSlverv1RjrZuPEZEnzYgqukwcRO9E+rlTFCCcIndSZ1P27f1goShFGycc2Wg6pxF1lRsvh2bxnJ4gWQAB0Vg7S7mNygM5JFTwk9HFWHuHCfpQWysu7EAvLNllKgO5u7WaLM9v9wuPcqGu9BUsLXo+wBZ+6w2b+8CZs2hjxEel3XOniCaYyfteNN57xwk1j+Sh3KcZMNwHu30tb6HiW6rnwyybehIG+YpOBm+RZnQ1+NytExcKMCuhDgQVqhducquuLEP3syTZl+EmN8NvIP3zp ssh-key-2026-04-14"
)
BOOT_VOLUME_GB = float(os.environ.get("OCI_BOOT_VOLUME_GB", "50"))
INTERNAL_API_TOKEN = os.environ.get("INTERNAL_API_TOKEN", "").strip()

# Perfiles escalonados Always Free ARM (OCPU, RAM_GB): busca desde el máximo Always Free (4 OCPU / 24 GB) hasta 1 OCPU / 6 GB
def parse_shape_profiles():
    raw = os.environ.get("OCI_SHAPE_PROFILES", "4:24,2:12,1:6")
    profiles = []
    for item in raw.split(","):
        parts = item.strip().split(":")
        if len(parts) == 2:
            try:
                profiles.append((float(parts[0]), float(parts[1])))
            except ValueError:
                pass
    return profiles if profiles else [(4.0, 24.0), (2.0, 12.0), (1.0, 6.0)]

ACTIVE_PROFILES = parse_shape_profiles()
FAULT_DOMAINS = [None, "FAULT-DOMAIN-1", "FAULT-DOMAIN-2", "FAULT-DOMAIN-3"]

MAX_LOG_BYTES = 10 * 1024 * 1024  # 10 MB

def log(message):
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    log_line = f"[{timestamp}] {message}\n"
    print(log_line, end="")
    try:
        if os.path.exists(LOG_PATH) and os.path.getsize(LOG_PATH) > MAX_LOG_BYTES:
            backup_path = LOG_PATH + ".1"
            if os.path.exists(backup_path):
                os.remove(backup_path)
            os.rename(LOG_PATH, backup_path)
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(log_line)
    except Exception as e:
        print(f"Failed to write to log file: {e}")

def send_whatsapp_alert(msg_text):
    try:
        url = "http://127.0.0.1:3000/send-message"
        data = json.dumps({"message": msg_text}).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if INTERNAL_API_TOKEN:
            headers["Authorization"] = f"Bearer {INTERNAL_API_TOKEN}"
        req = urllib.request.Request(
            url, 
            data=data, 
            headers=headers,
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=10) as response:
            res = response.read().decode("utf-8")
            log(f"WhatsApp alert sent successfully: {res}")
    except Exception as e:
        log(f"Failed to send WhatsApp alert: {e}")

def notify_success(instance_name, instance_id, ocpus, memory_gb, fault_domain):
    fd_label = fault_domain if fault_domain else "Automático (AD-1)"
    msg_text = (
        f"🤖 *Notificación de OCI*\n\n"
        f"¡La instancia *{instance_name}* se ha creado con éxito!\n\n"
        f"🆔 ID: `{instance_id}`\n"
        f"⚡ Estado: PROVISIONING / RUNNING\n"
        f"💻 Especificaciones: {int(ocpus)} OCPU / {int(memory_gb)} GB RAM / {int(BOOT_VOLUME_GB)} GB Disco (ARM Always Free)\n"
        f"🏢 Fault Domain: `{fd_label}`"
    )
    send_whatsapp_alert(msg_text)

def notify_fatal_error(error_detail):
    msg_text = (
        f"🚨 *ALERTA CRÍTICA - OCI Script Detenido*\n\n"
        f"El script de creación de instancia OCI se ha detenido por un error fatal no reintentable:\n\n"
        f"⚠️ *Detalle*: {error_detail}\n\n"
        f"Por favor revisá las credenciales o configuración en el VPS."
    )
    send_whatsapp_alert(msg_text)

def notify_daily_heartbeat(attempts, profiles):
    profiles_str = ", ".join([f"{int(o)}c/{int(m)}GB" for o, m in profiles])
    msg_text = (
        f"📊 *Reporte Diario - OCI Script*\n\n"
        f"El script `oci-creator` sigue activo y buscando la mejor capacidad de servidor ARM.\n\n"
        f"🔄 *Intentos acumulados*: {attempts:,}\n"
        f"🎯 *Perfiles buscados*: {profiles_str}\n"
        f"📍 *Estado*: Rotando Fault Domains (1-3) en Santiago (`AD-1`)."
    )
    send_whatsapp_alert(msg_text)

def check_instance_exists(compute_client):
    try:
        response = compute_client.list_instances(compartment_id=COMPARTMENT_ID, display_name=INSTANCE_NAME)
        for instance in response.data:
            if instance.lifecycle_state not in ["TERMINATED", "TERMINATING"]:
                log(f"Instance '{INSTANCE_NAME}' already exists (ID: {instance.id}, State: {instance.lifecycle_state}).")
                return True
        return False
    except Exception as e:
        log(f"Error checking instance existence: {e}")
        return None

def build_launch_details(ocpus, memory_gb, fault_domain=None):
    kwargs = dict(
        compartment_id=COMPARTMENT_ID,
        availability_domain=AVAILABILITY_DOMAIN,
        shape="VM.Standard.A1.Flex",
        shape_config=oci.core.models.LaunchInstanceShapeConfigDetails(
            ocpus=float(ocpus),
            memory_in_gbs=float(memory_gb)
        ),
        display_name=INSTANCE_NAME,
        source_details=oci.core.models.InstanceSourceViaImageDetails(
            source_type="image",
            image_id=IMAGE_ID,
            boot_volume_size_in_gbs=BOOT_VOLUME_GB
        ),
        create_vnic_details=oci.core.models.CreateVnicDetails(
            subnet_id=SUBNET_ID,
            assign_public_ip=True
        ),
        metadata={
            "ssh_authorized_keys": SSH_AUTHORIZED_KEYS
        }
    )
    if fault_domain:
        kwargs["fault_domain"] = fault_domain
    return oci.core.models.LaunchInstanceDetails(**kwargs)

try:
    config = oci.config.from_file(CONFIG_PATH, "DEFAULT")
except Exception as e:
    fatal_msg = f"Error al cargar la configuración OCI desde {CONFIG_PATH}: {e}"
    log(fatal_msg)
    notify_fatal_error(fatal_msg)
    sys.exit(1)

compute_client = oci.core.ComputeClient(config)

profiles_summary = ", ".join([f"{int(o)} OCPU / {int(m)} GB RAM" for o, m in ACTIVE_PROFILES])
log(f"Starting Oracle Instance Creation Loop (Profiles: {profiles_summary} | Boot Volume: {int(BOOT_VOLUME_GB)} GB)")
log(f"Target Subnet: {SUBNET_ID}")
log(f"Target Image: {IMAGE_ID}")

base_retry_delay = 30  # Base seconds between attempts
attempt_count = 0
last_daily_report_time = time.time()
DAILY_REPORT_INTERVAL_SEC = 24 * 3600  # 24 hours
EXISTENCE_CHECK_INTERVAL_ATTEMPTS = 60  # Verificar existencia solo al inicio, cada 60 intentos (~30m) o ante LimitExceeded

while True:
    attempt_count += 1

    # Check for daily heartbeat notification (once every 24 hours)
    if time.time() - last_daily_report_time >= DAILY_REPORT_INTERVAL_SEC:
        notify_daily_heartbeat(attempt_count, ACTIVE_PROFILES)
        last_daily_report_time = time.time()

    # Check if instance already exists only at startup or periodically to avoid doubling API requests per cycle
    if attempt_count == 1 or (attempt_count % EXISTENCE_CHECK_INTERVAL_ATTEMPTS == 0):
        exists = check_instance_exists(compute_client)
        if exists is True:
            log("Instance exists. Suspending request loop. Sleeping indefinitely...")
            while True:
                time.sleep(3600)
        elif exists is None and attempt_count == 1:
            log(f"Could not verify instance existence at startup due to API error. Retrying in {base_retry_delay}s...")
            time.sleep(base_retry_delay)
            attempt_count = 0
            continue

    # Seleccionar perfil de capacidad (OCPU, RAM) y Fault Domain cubriendo todas las combinaciones
    profile_idx = (attempt_count - 1) % len(ACTIVE_PROFILES)
    target_ocpus, target_memory_gb = ACTIVE_PROFILES[profile_idx]
    fd_idx = ((attempt_count - 1) // len(ACTIVE_PROFILES)) % len(FAULT_DOMAINS)
    target_fd = FAULT_DOMAINS[fd_idx]
    fd_str = target_fd if target_fd else "AUTO"

    launch_details = build_launch_details(target_ocpus, target_memory_gb, target_fd)

    try:
        response = compute_client.launch_instance(launch_details)
        instance = response.data
        log(f"SUCCESS! Instance created successfully ({int(target_ocpus)} OCPU / {int(target_memory_gb)} GB RAM, FD: {fd_str}).")
        log(f"Instance ID: {instance.id}")
        log(f"Display Name: {instance.display_name}")
        log(f"Lifecycle State: {instance.lifecycle_state}")
        
        # Send WhatsApp notification via the local HTTP server
        notify_success(instance.display_name, instance.id, target_ocpus, target_memory_gb, target_fd)
        
        log("Suspending loop. Sleeping indefinitely...")
        while True:
            time.sleep(3600)

    except oci.exceptions.ServiceError as e:
        msg = str(e.message) if e.message else ""
        code = str(e.code) if e.code else ""
        status = e.status if hasattr(e, 'status') else 0

        # Si el error es LimitExceeded, verificar si la instancia ya fue creada o si el perfil supera la cuota disponible
        if code == "LimitExceeded" or "limit" in msg.lower():
            exists_now = check_instance_exists(compute_client)
            if exists_now is True:
                log("Instance already created! Suspending request loop. Sleeping indefinitely...")
                while True:
                    time.sleep(3600)
            if len(ACTIVE_PROFILES) > 1 and target_ocpus > 1.0:
                log(f"Profile {int(target_ocpus)} OCPU / {int(target_memory_gb)} GB RAM exceeded tenancy limit ({msg.strip()}). Removing profile and continuing with smaller shapes.")
                ACTIVE_PROFILES = [p for p in ACTIVE_PROFILES if p != (target_ocpus, target_memory_gb)]
                time.sleep(5)
                continue

        # Check if error is retryable (Capacity, Limit, 429 Rate Limit, 50x Server Error)
        is_capacity_error = (
            code in ["OutOfHostCapacity", "LimitExceeded", "TooManyRequests", "InternalError"] or
            "capacity" in msg.lower() or
            "limit" in msg.lower() or
            "outofcapacity" in code.lower() or
            status in [429, 500, 502, 503, 504]
        )

        if is_capacity_error:
            jitter = random.randint(0, 5)
            
            if status == 429 or code == "TooManyRequests":
                wait_time = 120 + jitter
                log(f"API Rate limit reached (429). Waiting extended delay of {wait_time}s...")
            else:
                wait_time = base_retry_delay + jitter
                log(f"[Attempt #{attempt_count} | {int(target_ocpus)}c/{int(target_memory_gb)}GB | FD:{fd_str}] No capacity ({code or status}): {msg.strip()}. Retrying in {wait_time}s...")
            
            time.sleep(wait_time)
        else:
            # Fatal configuration / authentication error (400, 401, 403, 404, etc.)
            fatal_detail = f"Service Error ({code} / Status {status}): {msg.strip()}"
            log(f"FATAL ERROR: {fatal_detail}. Stopping script execution.")
            notify_fatal_error(fatal_detail)
            sys.exit(1)

    except Exception as e:
        log(f"Unexpected Exception: {e}. Retrying in {base_retry_delay}s...")
        time.sleep(base_retry_delay)
