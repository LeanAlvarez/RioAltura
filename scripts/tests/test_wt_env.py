"""Tests for scripts/wt-env.sh: stable, distinct ports per worktree."""

import os
import shutil
import socket
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "wt-env.sh"


def run_wt_env(root: Path, *, skip_port_check: bool = True) -> dict[str, str]:
    env = {**os.environ, "WT_ENV_ROOT": str(root)}
    env.pop("WT_ENV_NAME", None)
    if skip_port_check:
        env["WT_ENV_SKIP_PORT_CHECK"] = "1"
    else:
        env.pop("WT_ENV_SKIP_PORT_CHECK", None)
    subprocess.run(["bash", str(SCRIPT)], env=env, check=True, capture_output=True, text=True)
    return parse_env(root / ".env.local")


def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text().splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key] = value
    return values


@pytest.fixture
def worktree(tmp_path: Path):
    def make(name: str) -> Path:
        root = tmp_path / name
        root.mkdir()
        shutil.copy(REPO_ROOT / ".env.example", root / ".env.example")
        return root

    return make


def test_puertos_distintos_para_nombres_distintos(worktree) -> None:
    a = run_wt_env(worktree("bristlemouth"))
    b = run_wt_env(worktree("coralreef"))

    assert a["API_PORT"] != b["API_PORT"]
    assert a["WEB_PORT"] != b["WEB_PORT"]
    assert a["DB_PORT"] != b["DB_PORT"]
    assert a["COMPOSE_PROJECT_NAME"] == "rioaltura-bristlemouth"
    assert b["COMPOSE_PROJECT_NAME"] == "rioaltura-coralreef"


def test_puertos_estables_al_correr_dos_veces(worktree) -> None:
    root = worktree("bristlemouth")

    first = run_wt_env(root)
    second = run_wt_env(root)

    assert first == second


def test_offset_comun_a_los_tres_puertos(worktree) -> None:
    values = run_wt_env(worktree("bristlemouth"))
    offset = int(values["API_PORT"]) - 8000

    assert 0 <= offset <= 99
    assert int(values["WEB_PORT"]) == 5173 + offset
    assert int(values["DB_PORT"]) == 5432 + offset


def test_conserva_variables_existentes_y_pisa_solo_las_gestionadas(worktree) -> None:
    root = worktree("bristlemouth")
    (root / ".env.local").write_text(
        "API_PORT=1\nFLOODS_API_KEY=secreto\nMI_VAR=hola\nCOMPOSE_PROJECT_NAME=otro\n"
    )

    values = run_wt_env(root)

    assert values["FLOODS_API_KEY"] == "secreto"
    assert values["MI_VAR"] == "hola"
    assert values["API_PORT"] != "1"
    assert values["COMPOSE_PROJECT_NAME"] == "rioaltura-bristlemouth"


def test_sin_env_local_arranca_desde_env_example(worktree) -> None:
    values = run_wt_env(worktree("bristlemouth"))

    example = parse_env(REPO_ROOT / ".env.example")
    for key in ("POSTGRES_USER", "POSTGRES_DB", "FLOODS_API_KEY", "VITE_API_URL"):
        assert values[key] == example[key]


def test_nombre_con_mayusculas_y_simbolos_se_normaliza(worktree) -> None:
    values = run_wt_env(worktree("Feat_001 Infra"))

    assert values["COMPOSE_PROJECT_NAME"] == "rioaltura-feat-001-infra"


def test_deja_symlink_env_apuntando_a_env_local(worktree) -> None:
    root = worktree("bristlemouth")

    run_wt_env(root)

    assert (root / ".env").is_symlink()
    assert os.readlink(root / ".env") == ".env.local"


@pytest.mark.skipif(shutil.which("lsof") is None, reason="lsof no disponible")
def test_salta_el_offset_si_un_puerto_esta_ocupado(worktree) -> None:
    root = worktree("bristlemouth")
    free = run_wt_env(root, skip_port_check=True)
    api_port = int(free["API_PORT"])

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("127.0.0.1", api_port))
        except OSError:
            pytest.skip(f"puerto {api_port} ya ocupado por otro proceso")
        sock.listen(1)

        busy = run_wt_env(root, skip_port_check=False)

    assert int(busy["API_PORT"]) > api_port
    assert int(busy["WEB_PORT"]) - 5173 == int(busy["API_PORT"]) - 8000
