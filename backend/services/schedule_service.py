import models
import schemas


def version_to_schema(version: models.ScheduleVersion) -> schemas.ScheduleVersionOut:
    placements = [
        schemas.TalkPlacementOut(
            id=p.id,
            talk_id=p.talk_id,
            talk_title=p.talk.title,
            day_id=p.day_id,
            day_date=p.day.date,
            hall_id=p.hall_id,
            hall_name=p.hall.name,
            start_time=p.start_time,
            end_time=p.end_time,
            reasoning=p.reasoning,
            primary_track_id=p.talk.primary_track_id,
            track_ids=[t.id for t in p.talk.tracks],
        )
        for p in version.placements
    ]
    return schemas.ScheduleVersionOut(
        id=version.id,
        name=version.name,
        created_at=version.created_at,
        updated_at=version.updated_at,
        is_active=version.is_active,
        summary=version.summary,
        placement_count=len(placements),
        placements=placements,
    )
