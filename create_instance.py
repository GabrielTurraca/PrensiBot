import oci
import time
import sys
import os
import urllib.request
import urllib.parse
import json
import random

# Configuration paths
CONFIG_PATH = "/home/ubuntu/.oci/config"
LOG_PATH = "/home/ubuntu/oci-create-instance/creation.log"
INSTANCE_NAME = "prensi-bot-server-ARM"
COMPARTMENT_ID = "ocid1.compartment.oc1..aaaaaaaapjx74fkkbt756ep7irp6c3evmotu4sfw7lze5aoif3xi24umpxmq"

MAX_LOG_BYTES = 10 * 1024 * 1024  # 10 MB

def log(message):
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    log_line = f"[{timestamp}] {message}\n"
    print(log_line, end="")
    try:
        # Simple log rotation if file exceeds 10 MB
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
        req = urllib.request.Request(
            url, 
            data=data, 
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=10) as response:
            res = response.read().decode("utf-8")
            log(f"WhatsApp alert sent successfully: {res}")
    except Exception as e:
        log(f"Failed to send WhatsApp alert: {e}")

def notify_success(instance_name, instance_id):
    msg_text = (
        f"🤖 *Notificación de OCI*\n\n"
        f"¡La instancia *{instance_name}* se ha creado con éxito!\n\n"
        f"🆔 ID: `{instance_id}`\n"
        f"⚡ Estado: PROVISIONING / RUNNING\n"
        f"💻 Especificaciones: 1 OCPU / 6 GB RAM (ARM Always Free)"
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

def notify_daily_heartbeat(attempts):
    msg_text = (
        f"📊 *Reporte Diario - OCI Script*\n\n"
        f"El script `oci-creator` sigue activo y buscando capacidad de servidor ARM.\n\n"
        f"🔄 *Intentos en 24h*: {attempts:,}\n"
        f"📍 *Estado*: Esperando disponibilidad de Host en Santiago (AD-1)."
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

try:
    config = oci.config.from_file(CONFIG_PATH, "DEFAULT")
except Exception as e:
    fatal_msg = f"Error al cargar la configuración OCI desde {CONFIG_PATH}: {e}"
    log(fatal_msg)
    notify_fatal_error(fatal_msg)
    sys.exit(1)

compute_client = oci.core.ComputeClient(config)

launch_details = oci.core.models.LaunchInstanceDetails(
    compartment_id=COMPARTMENT_ID,
    availability_domain="oLnV:SA-SANTIAGO-1-AD-1",
    shape="VM.Standard.A1.Flex",
    shape_config=oci.core.models.LaunchInstanceShapeConfigDetails(
        ocpus=1.0,
        memory_in_gbs=6.0
    ),
    display_name=INSTANCE_NAME,
    image_id="ocid1.image.oc1.sa-santiago-1.aaaaaaaai5ja32pjngtc7qay4zz4cuhusti5wggho3nkkttm2j22z6dx7lya",
    create_vnic_details=oci.core.models.CreateVnicDetails(
        subnet_id="ocid1.subnet.oc1.sa-santiago-1.aaaaaaaadlrln3apqfe5g3srft2eogt5dlstclwv4jo42dmcbs424itvgdja",
        assign_public_ip=True
    ),
    metadata={
        "ssh_authorized_keys": "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDOsq2yGNd+ZjDQq8FPsWK+AVmJeXc0RCKzNPoN8a3kAmmpi/r7cR+V6tczZBV96CSlverv1RjrZuPEZEnzYgqukwcRO9E+rlTFCCcIndSZ1P27f1goShFGycc2Wg6pxF1lRsvh2bxnJ4gWQAB0Vg7S7mNygM5JFTwk9HFWHuHCfpQWysu7EAvLNllKgO5u7WaLM9v9wuPcqGu9BUsLXo+wBZ+6w2b+8CZs2hjxEel3XOniCaYyfteNN57xwk1j+Sh3KcZMNwHu30tb6HiW6rnwyybehIG+YpOBm+RZnQ1+NytExcKMCuhDgQVqhducquuLEP3syTZl+EmN8NvIP3zp ssh-key-2026-04-14"
    }
)

log("Starting Oracle Instance Creation Loop (1 OCPU, 6 GB RAM, Always Free ARM)")
log(f"Target Subnet: {launch_details.create_vnic_details.subnet_id}")
log(f"Target Image: {launch_details.image_id}")

base_retry_delay = 30  # Base seconds between attempts
attempt_count = 0
last_daily_report_time = time.time()
DAILY_REPORT_INTERVAL_SEC = 24 * 3600  # 24 hours

while True:
    attempt_count += 1

    # Check for daily heartbeat notification (once every 24 hours)
    if time.time() - last_daily_report_time >= DAILY_REPORT_INTERVAL_SEC:
        notify_daily_heartbeat(attempt_count)
        last_daily_report_time = time.time()

    # Check if instance already exists to avoid duplicate requests under PM2
    exists = check_instance_exists(compute_client)
    if exists is True:
        log("Instance exists. Suspending request loop. Sleeping indefinitely...")
        while True:
            time.sleep(3600)
    elif exists is None:
        log(f"Could not verify instance existence due to API error. Retrying in {base_retry_delay}s...")
        time.sleep(base_retry_delay)
        continue

    try:
        response = compute_client.launch_instance(launch_details)
        instance = response.data
        log("SUCCESS! Instance created successfully.")
        log(f"Instance ID: {instance.id}")
        log(f"Display Name: {instance.display_name}")
        log(f"Lifecycle State: {instance.lifecycle_state}")
        
        # Send WhatsApp notification via the local HTTP server
        notify_success(instance.display_name, instance.id)
        
        log("Suspending loop. Sleeping indefinitely...")
        while True:
            time.sleep(3600)

    except oci.exceptions.ServiceError as e:
        msg = str(e.message) if e.message else ""
        code = str(e.code) if e.code else ""
        status = e.status if hasattr(e, 'status') else 0

        # Check if error is retryable (Capacity, Limit, 429 Rate Limit, 50x Server Error)
        is_capacity_error = (
            code in ["OutOfHostCapacity", "LimitExceeded", "TooManyRequests"] or
            "capacity" in msg.lower() or
            "limit" in msg.lower() or
            "outofcapacity" in code.lower() or
            status in [429, 500, 502, 503, 504]
        )

        if is_capacity_error:
            # Add small random jitter (0 to 5 seconds) to avoid predictable request timing
            jitter = random.randint(0, 5)
            
            if status == 429 or code == "TooManyRequests":
                wait_time = 120 + jitter
                log(f"API Rate limit reached (429). Waiting extended delay of {wait_time}s...")
            else:
                wait_time = base_retry_delay + jitter
                log(f"No capacity available ({code or status}): {msg.strip()}. Retrying in {wait_time}s...")
            
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
