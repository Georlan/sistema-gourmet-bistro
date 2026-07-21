import os
import sys
from config import AgentConfig
from worker import run_agent_loop

def main():
    config_file = "config.json"
    if len(sys.argv) > 1:
        config_file = sys.argv[1]

    config = AgentConfig(config_file)
    run_agent_loop(config)

if __name__ == "__main__":
    main()
