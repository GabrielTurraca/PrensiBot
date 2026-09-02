import oci
import time
import sys
import os
import urllib.request
import urllib.parse
import json

# Configuration paths
CONFIG_PATH = "/home/ubuntu/.oci/config"
LOG_PATH = "/home/ubuntu/oci-create-instance/creation.log"
INSTANCE_NAME = "prensi-bot-server-ARM"
COMPARTMENT_ID = "ocid1.compartment.oc1..aaaaaaaapjx74fkkbt756ep7irp6c3evmotu4sfw7lze5aoif3xi24umpxmq"

def log(message):
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    log_line = f"[{timestamp}] {message}\n"
    print(log_line, end="")
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(log_line)
    except Exception as e:
        print(f"Failed to write to log file: {e}")

def notify_success(instance_name, instance_id):
    try:
        url = "http://127.0.0.1:3000/send-message"
        msg_text = f"🤖 *Notificación de OCI*\n\n¡La instancia *{instance_name}* se ha creado con éxito!\n\nID: {instance_id}\nEstado: PROVISIONING / RUNNING"
        data = json.dumps({"message": msg_text}).encode("utf-8")
        req = urllib.request.Request(
            url, 
            data=data, 
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=10) as response:
            res = response.read().decode("utf-8")
            log(f"Notification sent successfully: {res}")
    except Exception as e:
        log(f"Failed to send notification: {e}")

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
    log(f"Error loading OCI config: {e}")
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

retry_delay = 30  # seconds between attempts

while True:
    # Check if instance already exists to avoid duplicate requests or infinite loops under PM2
    exists = check_instance_exists(compute_client)
    if exists is True:
        log("Instance exists. Suspending request loop. Sleeping indefinitely...")
        while True:
            time.sleep(3600)
    elif exists is None:
        log(f"Could not verify instance existence due to API error. Retrying in {retry_delay}s...")
        time.sleep(retry_delay)
        continue

    try:
        response = compute_client.launch_instance(launch_details)
        instance = response.data
        log(f"SUCCESS! Instance created successfully.")
        log(f"Instance ID: {instance.id}")
        log(f"Display Name: {instance.display_name}")
        log(f"Lifecycle State: {instance.lifecycle_state}")
        
        # Send WhatsApp notification via the local HTTP server
        notify_success(instance.display_name, instance.id)
        
        log("Suspending loop. Sleeping indefinitely...")
        while True:
            time.sleep(3600)
    except oci.exceptions.ServiceError as e:
        msg = str(e.message)
        code = str(e.code)
        
        if e.status == 500 or "capacity" in msg.lower() or "limit" in msg.lower() or "limitexceeded" in code.lower() or "outofcapacity" in code.lower():
            log(f"No capacity or limit reached: {msg.strip()}. Retrying in {retry_delay}s...")
            time.sleep(retry_delay)
        else:
            log(f"Service Error ({code}): {msg.strip()}. Retrying in {retry_delay}s...")
            time.sleep(retry_delay)
    except Exception as e:
        log(f"Unexpected Error: {e}. Retrying in {retry_delay}s...")
        time.sleep(retry_delay)
