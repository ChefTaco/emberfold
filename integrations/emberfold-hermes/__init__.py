from .engine import EmberfoldEngine
from .onboarding import configure_parser, handle_cli


def register(ctx):
    ctx.register_auxiliary_task(
        "emberfold_compression", display_name="Emberfold compression",
        description="Tools-disabled, source-cited historical continuity",
        inherit_from="compression",
        defaults={"fallback_chain": []},
    )
    engine = EmberfoldEngine(llm=getattr(ctx, "llm", None))
    ctx.register_context_engine(engine)
    ctx.register_hook("pre_api_request", engine.observe_request)
    ctx.register_cli_command(
        "emberfold", "Set up and inspect Emberfold context continuity", configure_parser,
        handler_fn=lambda args: handle_cli(args, ctx),
    )
